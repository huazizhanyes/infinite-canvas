import { nanoid } from "nanoid";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { ScriptAsset } from "@/services/api/canvas-script";
import { CanvasNodeType, type AssetStoryboardShot, type AssetStoryboardState, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export type AssetReadiness = { ready: boolean; reason: string; pending: string[] };

export const ASSET_IMAGE_STATE_CHANGED_EVENT = "asset-extraction:image-state-changed";

export function inspectAssetReadiness(source: CanvasNodeData, assets: ScriptAsset[], nodes: CanvasNodeData[], pendingCount: number, contentHash?: string): AssetReadiness {
    const sourceHash = source.metadata?.assetExtractionContentHash;
    if (source.metadata?.assetExtractionStatus === "analyzing") return { ready: false, reason: "资产正在提取中", pending: [] };
    if (source.metadata?.assetExtractionStatus === "error") return { ready: false, reason: source.metadata?.errorDetails || "资产提取失败", pending: [] };
    if (!assets.length) return { ready: false, reason: "请先提取资产", pending: [] };
    if (sourceHash && contentHash && sourceHash !== contentHash) return { ready: false, reason: "正文版本已变化，请重新提取资产", pending: [] };
    if (pendingCount) return { ready: false, reason: `还有 ${pendingCount} 项资产待确认`, pending: [] };
    const assetNodes = nodes.filter((node) => node.type === CanvasNodeType.ScriptAsset && node.metadata?.assetExtractionNodeId === source.id);
    const byAssetId = new Map(assetNodes.map((node) => [node.metadata?.scriptAssetId, node]));
    const pending: string[] = [];
    assets.forEach((asset) => {
        const node = byAssetId.get(asset.id);
        const imageStatus = node?.metadata?.scriptAssetImageStatus;
        if (!node) pending.push(`${asset.name}节点未创建`);
        else if (["queued", "pending", "running", "generating", "processing", "uploading"].includes(String(imageStatus)) || node.metadata?.mediaStatus === "uploading") pending.push(`${asset.name}图片处理中`);
        else if (!node.metadata?.content) pending.push(imageStatus === "failed" || node.metadata?.mediaStatus === "failed" ? `${asset.name}图片失败` : `${asset.name}未上传或生成图片`);
    });
    return pending.length ? { ready: false, reason: pending[0], pending } : { ready: true, reason: "全部资产图片已就绪", pending: [] };
}

export function buildStoryboardAnalysisPrompt(source: CanvasNodeData, assets: ScriptAsset[]) {
    const assetCatalog = assets.map((asset) => `- ${asset.id} | ${asset.type} | ${asset.name} | ${asset.visualDescription || "无视觉描述"}`).join("\n");
    return `你是短剧导演和分镜师。请把下面正文拆成多个可独立生成的视频分镜。每个镜头时长必须是 5-15 秒整数，按剧情动作、对白、场景和情绪转折自然切分，不能把整段剧情塞进一个镜头。镜头之间必须保持人物、场景、道具、轴线、视线和动作连续。只输出 JSON，不要 Markdown。

资产目录（assetIds 只能从这里选择）：
${assetCatalog || "无"}

正文：
${source.metadata?.content || ""}

JSON 格式：{"title":"","totalDurationSec":0,"continuityBible":"","shots":[{"index":1,"durationSec":8,"title":"","sourceExcerpt":"","storyPurpose":"","visualDescription":"","shotSize":"","lighting":"","dialogue":"","sound":"","cameraMovement":"","characters":[],"assetIds":[],"previousHandoff":"","startState":"","endState":"","continuity":"","negativeConstraints":[]}]}`;
}

export function parseStoryboardAnalysis(raw: string, validAssetIds: Set<string>): Pick<AssetStoryboardState, "title" | "totalDurationSec" | "continuityBible" | "shots"> {
    const json = repairStoryboardJson(extractJson(raw));
    const value = JSON.parse(json) as Record<string, unknown>;
    const rawShots = Array.isArray(value.shots) ? value.shots : [];
    if (!rawShots.length) throw new Error("AI 未返回有效分镜");
    const shots: AssetStoryboardShot[] = rawShots.map((item, index) => {
        const shot = (item || {}) as Record<string, unknown>;
        const duration = Math.max(5, Math.min(15, Math.round(Number(shot.durationSec || 8))));
        const assetIds = arrayOfStrings(shot.assetIds).filter((id) => validAssetIds.has(id));
        return {
            id: nanoid(), index: index + 1, durationSec: duration,
            title: stringOf(shot.title, `分镜 ${index + 1}`), sourceExcerpt: stringOf(shot.sourceExcerpt), storyPurpose: stringOf(shot.storyPurpose),
            visualDescription: stringOf(shot.visualDescription), shotSize: stringOf(shot.shotSize, "中景"), lighting: stringOf(shot.lighting), dialogue: stringOf(shot.dialogue), sound: stringOf(shot.sound), cameraMovement: stringOf(shot.cameraMovement),
            characters: arrayOfStrings(shot.characters), assetIds, previousHandoff: stringOf(shot.previousHandoff), startState: stringOf(shot.startState), endState: stringOf(shot.endState), continuity: stringOf(shot.continuity), negativeConstraints: arrayOfStrings(shot.negativeConstraints), promptStatus: "idle",
        };
    });
    return { title: stringOf(value.title, "分镜脚本"), totalDurationSec: shots.reduce((sum, shot) => sum + shot.durationSec, 0), continuityBible: stringOf(value.continuityBible), shots };
}

export function buildShotPrompt(shot: AssetStoryboardShot, assets: ScriptAsset[], source: CanvasNodeData) {
    const names = new Map(assets.map((asset) => [asset.id, asset.name]));
    const refs = shot.assetIds.map((id, index) => `图片${index + 1}=@${names.get(id) || id}`).join("、") || "无";
    return `分镜 ${shot.index}：${shot.title}
建议时长：${shot.durationSec} 秒

原文依据：${shot.sourceExcerpt || "无"}
剧情目的：${shot.storyPurpose || "推进当前剧情"}

出场角色：${shot.characters.join("、") || "按画面描述"}
参考资产：${refs}

前一镜头结束状态：${shot.previousHandoff || "承接上一镜头的最终状态"}
当前镜头画面：${shot.visualDescription}
景别：${shot.shotSize}
光影氛围：${shot.lighting}
人物动作与关系：${shot.continuity || shot.startState}
镜头运动：${shot.cameraMovement}
对白/旁白：${shot.dialogue || "无"}
音效：${shot.sound || "环境底噪"}

结束状态：${shot.endState || "保持动作和站位稳定，作为下一镜头起点"}
连续性约束：${source.metadata?.assetExtractionVisualStyle || "保持既定视觉风格"}；${shot.continuity || "保持人物身份、服装、场景、道具、轴线和视线一致"}
禁止项：${shot.negativeConstraints.join("、") || "禁止新增人物、改变服装、跳轴、肢体变形、背景结构漂移"}`;
}

export function buildVideoScriptOps(storyboard: CanvasNodeData, source: CanvasNodeData, state: AssetStoryboardState, assetNodes: CanvasNodeData[], existingNodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasAgentOp[] {
    const ops: CanvasAgentOp[] = [];
    const existing = new Map(existingNodes.filter((node) => node.type === CanvasNodeType.Video && node.metadata?.assetStoryboardSourceId === storyboard.id).map((node) => [node.metadata?.assetStoryboardShotId, node]));
    const selectedIds: string[] = [];
    state.shots.forEach((shot, index) => {
        if (!shot.finalPrompt) return;
        const old = existing.get(shot.id);
        const id = old?.id || nanoid();
        selectedIds.push(id);
        const position = { x: storyboard.position.x + 360 + (index % 3) * 540, y: storyboard.position.y + Math.floor(index / 3) * 330 };
        const metadata = { prompt: shot.finalPrompt, seconds: String(shot.durationSec), status: "idle" as const, assetStoryboardSourceId: storyboard.id, assetStoryboardShotId: shot.id, assetStoryboardShotIndex: shot.index, sourceNodeId: storyboard.id, references: shot.assetIds };
        if (old) ops.push({ type: "update_node", id, patch: { title: `分镜 ${shot.index} · ${shot.title} · ${shot.durationSec}秒`, position, width: 420, height: 236 }, metadata });
        else ops.push({ type: "add_node", id, nodeType: CanvasNodeType.Video, title: `分镜 ${shot.index} · ${shot.title} · ${shot.durationSec}秒`, position, width: 420, height: 236, metadata });
        if (!connections.some((connection) => connection.fromNodeId === storyboard.id && connection.toNodeId === id)) ops.push({ type: "connect_nodes", id: nanoid(), fromNodeId: storyboard.id, toNodeId: id });
        assetNodes.filter((node) => shot.assetIds.includes(String(node.metadata?.scriptAssetId))).forEach((assetNode) => {
            if (!connections.some((connection) => connection.fromNodeId === assetNode.id && connection.toNodeId === id)) ops.push({ type: "connect_nodes", id: nanoid(), fromNodeId: assetNode.id, toNodeId: id });
        });
    });
    ops.push({ type: "select_nodes", ids: selectedIds });
    return ops;
}

function extractJson(raw: string) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const text = (fenced || raw).trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI 返回内容不是 JSON");
    return text.slice(start, end + 1);
}

function repairStoryboardJson(json: string) {
    // 某些模型会把 shots 的第一个对象输出成 `[index":1`，补回对象起始符和键名引号。
    return json.replace(/("shots"\s*:\s*)\[\s*index\s*"?\s*:/i, '$1[{"index":');
}

function stringOf(value: unknown, fallback = "") { return typeof value === "string" ? value.trim() : fallback; }
function arrayOfStrings(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : []; }
