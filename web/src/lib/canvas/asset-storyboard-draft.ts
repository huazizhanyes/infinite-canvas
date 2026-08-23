import { nanoid } from "nanoid";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { ScriptAsset } from "@/services/api/canvas-script";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export type AssetStoryboardDraft = {
    storyboardContent: string;
    videoPrompt: string;
    storyboardNodeId: string;
    videoNodeId: string;
    ops: CanvasAgentOp[];
};

/** 将正文与已提取资产整理为可审核的分镜草稿，不触发任何生成任务。 */
export function buildAssetStoryboardDraft(source: CanvasNodeData, assets: ScriptAsset[], nodes: CanvasNodeData[], connections: CanvasConnection[]): AssetStoryboardDraft {
    const existingStoryboard = nodes.find((node) => node.metadata?.assetExtractionStoryboardSourceId === source.id);
    const existingVideo = nodes.find((node) => node.metadata?.assetExtractionVideoDraftSourceId === source.id);
    const storyboardNodeId = existingStoryboard?.id || nanoid();
    const videoNodeId = existingVideo?.id || nanoid();
    const imageAssets = assets.filter((asset) => asset.image?.imageUrl || nodes.some((node) => node.metadata?.scriptAssetId === asset.id && node.metadata?.content));
    const references = imageAssets.map((_asset, index) => `图片${index + 1}`);
    const characters = assets.filter((asset) => asset.type === "character");
    const scenes = assets.filter((asset) => asset.type === "scene");
    const props = assets.filter((asset) => asset.type === "prop");
    const assetLines = (items: ScriptAsset[]) => items.length ? items.map((asset) => `- ${asset.name}：${asset.visualDescription || "待补充视觉描述"}`).join("\n") : "- 无";
    const referenceLine = references.length ? references.map((label, index) => `${label}=${imageAssets[index]?.name || "资产图片"}`).join("、") : "无可用资产图片";
    const storyboardContent = [
        "分镜脚本草稿",
        "",
        "原文：",
        source.metadata?.content?.trim() || "（未填写正文）",
        "",
        "场景：",
        assetLines(scenes),
        "",
        "人物：",
        assetLines(characters),
        "",
        "道具：",
        assetLines(props),
        "",
        "人物关系：",
        characters.length > 1 ? `${characters.map((asset) => asset.name).join("、")}在本段中保持既定关系，按原文冲突与互动推进。` : "请根据原文补充人物关系。",
        "",
        "镜头语言：",
        "以建立镜头交代场景，中景承接人物关系，近景捕捉关键表情与动作，必要时用推拉摇移强化情绪；保持人物、视线和空间连续。",
        "",
        "视频节奏：",
        "按原文事件顺序组织镜头，先交代再推进冲突，关键动作留出明确起止状态。",
        "",
        "声音与对白：",
        "保留原文对白与叙事信息，环境声服务于场景氛围，未确认内容不擅自补写。",
        "",
        `参考图片：${referenceLine}`,
    ].join("\n");
    const videoPrompt = [
        "请根据以下分镜脚本生成一段视频。严格保持人物身份、人物关系、场景和道具连续，按镜头语言完成动作与运镜，不添加未确认的剧情。",
        "",
        storyboardContent,
        references.length ? `\n提示：${references.join("、")}为已连接的资产参考图，请按编号对应使用。` : "",
    ].join("\n");
    const storyboardPosition = { x: source.position.x + source.width + 96, y: source.position.y + source.height + 96 };
    const videoPosition = { x: storyboardPosition.x + 340 + 96, y: storyboardPosition.y };
    const ops: CanvasAgentOp[] = [
        {
            type: existingStoryboard ? "update_node" : "add_node",
            id: storyboardNodeId,
            ...(existingStoryboard ? { patch: { title: "分镜脚本草稿", position: storyboardPosition, width: 340, height: 420 } } : { nodeType: CanvasNodeType.Text, title: "分镜脚本草稿", position: storyboardPosition, width: 340, height: 420 }),
            metadata: { content: storyboardContent, status: "success", assetExtractionStoryboardSourceId: source.id },
        },
        {
            type: existingVideo ? "update_node" : "add_node",
            id: videoNodeId,
            ...(existingVideo ? { patch: { title: "视频草稿", position: videoPosition, width: 420, height: 236 } } : { nodeType: CanvasNodeType.Video, title: "视频草稿", position: videoPosition, width: 420, height: 236 }),
            metadata: { prompt: videoPrompt, status: "idle", assetExtractionVideoDraftSourceId: source.id, sourceNodeId: storyboardNodeId },
        },
        ...(!connections.some((connection) => connection.fromNodeId === source.id && connection.toNodeId === storyboardNodeId) ? [{ type: "connect_nodes" as const, id: nanoid(), fromNodeId: source.id, toNodeId: storyboardNodeId }] : []),
        ...(!connections.some((connection) => connection.fromNodeId === storyboardNodeId && connection.toNodeId === videoNodeId) ? [{ type: "connect_nodes" as const, id: nanoid(), fromNodeId: storyboardNodeId, toNodeId: videoNodeId }] : []),
    ];
    const assetNodes = nodes.filter((node) => node.type === CanvasNodeType.ScriptAsset && node.metadata?.assetExtractionNodeId === source.id && imageAssets.some((asset) => asset.id === node.metadata?.scriptAssetId));
    assetNodes.forEach((node) => {
        if (!connections.some((connection) => connection.fromNodeId === node.id && connection.toNodeId === videoNodeId)) ops.push({ type: "connect_nodes", id: nanoid(), fromNodeId: node.id, toNodeId: videoNodeId });
    });
    ops.push({ type: "select_nodes", ids: [videoNodeId] });
    return { storyboardContent, videoPrompt, storyboardNodeId, videoNodeId, ops };
}

export function assetExtractionContentHash(content: string) {
    let hash = 2166136261;
    for (let index = 0; index < content.length; index += 1) hash = Math.imul(hash ^ content.charCodeAt(index), 16777619);
    return (hash >>> 0).toString(16);
}
