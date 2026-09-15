import { nanoid } from "nanoid";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { ScriptAsset } from "@/services/api/canvas-script";
import { CanvasNodeType, type AssetStoryboardActionBeat, type AssetStoryboardDialogueLine, type AssetStoryboardKeyframePlan, type AssetStoryboardShot, type AssetStoryboardShotSegment, type AssetStoryboardState, type AssetStoryboardVideoUnit, type CanvasConnection, type CanvasNodeData, type CanvasShotDurationMode, type CanvasShotKeyframeKind, type CanvasShotTransitionType } from "@/types/canvas";

export type AssetReadiness = { ready: boolean; reason: string; pending: string[] };
export type ShotDurationCapabilities = { min?: number | null; max?: number | null; options?: number[] | null };
export type ShotDurationSelection = { durationSec: number; requiredDurationSec: number; durationMode: CanvasShotDurationMode; durationOptions: number[] };

export const ASSET_IMAGE_STATE_CHANGED_EVENT = "asset-extraction:image-state-changed";
const DEFAULT_MIN_DURATION_SECONDS = 5;
const DEFAULT_MAX_DURATION_SECONDS = 15;
const SHORT_VIDEO_UNIT_MAX_SECONDS = 15;
const MAX_SEGMENTS_PER_UNIT = 6;

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

export function buildStoryboardAnalysisPrompt(source: CanvasNodeData, assets: ScriptAsset[], options: { durationMode?: CanvasShotDurationMode; capabilities?: ShotDurationCapabilities | null } = {}) {
    const assetCatalog = assets.map((asset) => `- ${asset.id} | ${asset.type} | ${asset.name} | ${asset.visualDescription || "无视觉描述"}`).join("\n");
    const durationOptions = videoDurationOptions(options.capabilities);
    const maximum = durationOptions.at(-1) || DEFAULT_MAX_DURATION_SECONDS;
    return `你是短剧导演和分镜师。请逐段完整改编下面正文，拆成连续、可自由组合的原子镜头 Shot。禁止摘要式跳过剧情，禁止把多个事件合并成一个镜头，禁止删除原文对白或把多人对白合成一句。每个原文段落、关键动作、关键对白都必须至少出现在一个 Shot 中；如果正文很长，可以继续增加 Shot 数量，不要为了减少数量而压缩内容。durationSec 只是初步估计，系统会根据对白和动作重新计算真实时长。

每句对白必须单独放入 dialogueLines；画外音、内心活动放入 dialogueLines 并把 type 设为 voice-over。visualDescription 只写画面动作，actionBeats 按“准备、释放、结果”或具体动作拆成多个节拍。不要按 VideoUnit 分组，系统会根据视频模型能力再把多个 Shot 自由组合成视频节点。

同时判断相邻镜头关系。transitionBefore 和 transitionToNext 只能使用：start、continuous、hard-cut、scene-change、time-jump、montage、flashback。只有连续动作、快速位移、道具交接、施法结果或用户必须锁定的关键画面才把 needsKeyframe 设为 true；普通切镜、换景别、换机位、场景切换、时间跳跃和蒙太奇不要生成多余关键帧。keyframeDescription 只在 needsKeyframe 为 true 时填写，描述需要生成的那一张参考画面。

相邻 Shot 必须保持人物、场景、道具、轴线、视线和动作连续。只输出 JSON，不要 Markdown。

资产目录（assetIds 只能从这里选择）：
${assetCatalog || "无"}

正文：
${source.metadata?.content || ""}

JSON 格式：{"title":"","totalDurationSec":0,"continuityBible":"","shots":[{"index":1,"durationSec":3,"title":"","sourceExcerpt":"","storyPurpose":"","visualDescription":"","shotSize":"","lighting":"","dialogue":"","dialogueLines":[{"speaker":"角色名","text":"完整对白","type":"dialogue"}],"actionBeats":[{"description":"动作节拍"}],"sound":"","cameraMovement":"","characters":[],"assetIds":[],"sceneAssetId":"","previousHandoff":"","startState":"","endState":"","continuity":"","negativeConstraints":[],"transitionBefore":"start","transitionToNext":"hard-cut","needsKeyframe":false,"keyframeDescription":""}]}`;
}

export function parseStoryboardAnalysis(raw: string, validAssetIds: Set<string>, options: { durationMode?: CanvasShotDurationMode; capabilities?: ShotDurationCapabilities | null } = {}): Pick<AssetStoryboardState, "title" | "totalDurationSec" | "continuityBible" | "shots"> {
    const json = repairStoryboardJson(extractJson(raw));
    const value = JSON.parse(json) as Record<string, unknown>;
    const rawShots = Array.isArray(value.shots) ? value.shots : [];
    if (!rawShots.length) throw new Error("AI 未返回有效分镜");
    const durationMode = options.durationMode || "short";
    const durationOptions = videoDurationOptions(options.capabilities);
    const maximum = durationOptions.at(-1) || DEFAULT_MAX_DURATION_SECONDS;
    const shots: AssetStoryboardShot[] = rawShots.map((item, index) => {
        const shot = (item || {}) as Record<string, unknown>;
        const dialogueLines = parseDialogueLines(shot.dialogueLines, stringOf(shot.dialogue));
        const actionBeats = parseActionBeats(shot.actionBeats, stringOf(shot.visualDescription));
        const duration = estimateShotDuration(dialogueLines, actionBeats, Number(shot.durationSec || 0));
        const assetIds = arrayOfStrings(shot.assetIds).filter((id) => validAssetIds.has(id));
        return {
            id: nanoid(), index: index + 1, durationSec: duration,
            requiredDurationSec: duration, durationMode, durationOptions,
            title: stringOf(shot.title, `镜头 ${index + 1}`), sourceExcerpt: stringOf(shot.sourceExcerpt), storyPurpose: stringOf(shot.storyPurpose),
            visualDescription: stringOf(shot.visualDescription), shotSize: stringOf(shot.shotSize, "中景"), lighting: stringOf(shot.lighting), dialogue: dialogueLines.map(formatDialogueLine).join("\n") || stringOf(shot.dialogue), dialogueLines, actionBeats, sound: stringOf(shot.sound), cameraMovement: stringOf(shot.cameraMovement),
            characters: arrayOfStrings(shot.characters), assetIds, sceneAssetId: stringOf(shot.sceneAssetId), previousHandoff: stringOf(shot.previousHandoff), startState: stringOf(shot.startState), endState: stringOf(shot.endState), continuity: stringOf(shot.continuity), negativeConstraints: arrayOfStrings(shot.negativeConstraints),
            transitionBefore: shotTransitionType(shot.transitionBefore, index === 0 ? "start" : "hard-cut"), transitionToNext: shotTransitionType(shot.transitionToNext, "hard-cut"), needsKeyframe: shot.needsKeyframe === true, keyframeDescription: stringOf(shot.keyframeDescription), promptStatus: "idle",
        };
    });
    return { title: stringOf(value.title, "分镜脚本"), totalDurationSec: shots.reduce((sum, shot) => sum + shot.durationSec, 0), continuityBible: stringOf(value.continuityBible), shots };
}

export function videoDurationOptions(capabilities?: ShotDurationCapabilities | null) {
    const values = Array.isArray(capabilities?.options) ? capabilities?.options || [] : [];
    const minimum = Math.max(1, Math.ceil(Number(capabilities?.min ?? DEFAULT_MIN_DURATION_SECONDS)));
    const maximum = Math.max(minimum, Math.floor(Number(capabilities?.max ?? Math.max(minimum, DEFAULT_MAX_DURATION_SECONDS))));
    const options = Array.from(new Set(values.map(Number).filter((value) => Number.isInteger(value) && value >= minimum && value <= maximum))).sort((left, right) => left - right);
    if (options.length) return options;
    return Array.from({ length: maximum - minimum + 1 }, (_item, index) => minimum + index);
}

export function resolveShotDuration(requiredDurationSec: number, durationMode: CanvasShotDurationMode = "short", capabilities?: ShotDurationCapabilities | null, randomKey = ""): ShotDurationSelection {
    const options = videoDurationOptions(capabilities);
    const required = Math.max(options[0], Math.round(Number(requiredDurationSec) || options[0]));
    const candidates = options.filter((value) => value >= required);
    const valid = candidates.length ? candidates : [options.at(-1)!];
    const index = durationMode === "long" ? valid.length - 1 : durationMode === "random" ? randomDurationIndex(randomKey, valid.length) : 0;
    const durationSec = valid[index] || valid[0];
    return { durationSec, requiredDurationSec: required, durationMode, durationOptions: options };
}

export function buildVideoUnits(shots: AssetStoryboardShot[], durationMode: CanvasShotDurationMode = "short", capabilities?: ShotDurationCapabilities | null, assets: ScriptAsset[] = []) {
    const units: AssetStoryboardVideoUnit[] = [];
    const options = videoDurationOptions(capabilities);
    const modelMax = options.at(-1) || DEFAULT_MAX_DURATION_SECONDS;
    const packableShots = shots.flatMap((shot) => splitShotForModel(shot, modelMax));
    let cursor = 0;
    while (cursor < packableShots.length) {
        const unitIndex = units.length + 1;
        const first = packableShots[cursor];
        const resolvedMode = durationMode === "random" ? randomUnitMode(`${first.id}:${unitIndex}`, first.durationSec, modelMax) : durationMode;
        let targetMax = resolvedMode === "long" ? modelMax : Math.min(SHORT_VIDEO_UNIT_MAX_SECONDS, modelMax);
        let effectiveMode = resolvedMode;
        if (first.durationSec > targetMax && first.durationSec <= modelMax) {
            targetMax = modelMax;
            effectiveMode = "long";
        }
        const group = [first];
        let requiredDuration = first.durationSec;
        while (cursor + group.length < packableShots.length && group.length < MAX_SEGMENTS_PER_UNIT) {
            const next = packableShots[cursor + group.length];
            const nextTotal = requiredDuration + next.durationSec;
            if (nextTotal > targetMax || nextTotal > modelMax) break;
            if (!canMergeVideoShots(group[group.length - 1], next)) break;
            group.push(next);
            requiredDuration = nextTotal;
        }
        const durationSec = legalVideoUnitDuration(requiredDuration, capabilities);
        units.push(createVideoUnit(unitIndex, group, durationSec, effectiveMode, requiredDuration));
        cursor += group.length;
    }
    return completeVideoUnitReferences(units, packableShots, assets);
}

export function buildVideoUnitPrompt(unit: AssetStoryboardVideoUnit, shots: AssetStoryboardShot[], assets: ScriptAsset[], source: CanvasNodeData) {
    const shotById = new Map(shots.map((shot) => [shot.id, shot]));
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const referencedAssets = unit.assetIds.map((id) => assetById.get(id)).filter((asset): asset is ScriptAsset => Boolean(asset));
    const anchors = referencedAssets.map((asset, index) => `@图片${index + 1} = ${asset.name}：${asset.visualDescription || asset.imagePrompt || "保持参考图外观"}`).join("\n");
    const sceneAsset = unit.sceneAssetId ? assetById.get(unit.sceneAssetId) : undefined;
    const sceneIndex = sceneAsset ? referencedAssets.findIndex((asset) => asset.id === sceneAsset.id) : -1;
    const sceneReference = sceneAsset && sceneIndex >= 0 ? `@图片${sceneIndex + 1} = ${sceneAsset.name}` : "未提供独立场景参考";
    const keyframes = unit.keyframes?.filter((keyframe) => keyframe.status === "success" && keyframe.nodeId) || [];
    const keyframeAnchors = keyframes.map((keyframe, index) => `@图片${referencedAssets.length + index + 1} = ${keyframe.title}：${keyframe.prompt}`).join("\n");
    const referencedNames = referencedAssets.map((asset) => asset.name);
    const style = source.metadata?.assetExtractionVisualStyle || "电影级写实风格";
    const negative = unit.negativeConstraints.join("、") || "禁止新增未登记人物、改变服装、跳轴、肢体变形、背景结构漂移和画面字幕";
    const timeline = unit.segments.map((segment, index) => {
        const shot = shotById.get(segment.shotId);
        const actionText = segment.actionBeats?.map((beat) => beat.description).join(" → ") || "";
        const dialogueText = segment.dialogueLines?.map(formatDialogueLine).join("；") || segment.dialogue;
        return [
            `【镜号${index + 1}】${segment.startSec}-${segment.endSec}秒`,
            `画面：${segment.visualDescription}`,
            `景别：${segment.shotSize || "中景"}`,
            `镜头运动：${segment.cameraMovement || "稳定连续运动"}`,
            shot?.lighting ? `光影：${shot.lighting}` : "",
            actionText ? `动作节拍：${actionText}` : "",
            `动作状态：从“${segment.startState || "当前状态"}”过渡到“${segment.endState || "保持动作稳定"}”`,
            dialogueText ? `对白/旁白：${dialogueText}` : "",
            segment.sound ? `同步音效：${segment.sound}` : "",
            shot?.transitionToNext ? `衔接：${transitionLabel(shot.transitionToNext)}` : "",
        ].filter(Boolean).join("\n");
    }).join("\n\n");
    return `【格式】
${unit.durationSec}秒，${style}，视听一体，真实音画同步。

【视觉风格】
${style}，人物与环境写实一致，光影、色彩和镜头运动保持统一。

【世界与场景】
本单元场景参考：${sceneReference}。保持场景结构、光线方向和空间轴线一致。

【角色与场景锚定】
${anchors || "按已连接参考图保持人物、场景和道具一致"}

${keyframeAnchors ? `【关键帧参考】\n${keyframeAnchors}\n` : ""}

【时间轴】
${timeline || `${0}-${unit.durationSec}秒：按画面描述连续完成本段动作。`}

【声音】
对白和音效按对应时间段同步执行，人物仅在说台词时开口。
出场角色：${referencedNames.join("、") || "按画面描述"}。

【连续性与输出约束】
前一视频单元结束状态：${unit.previousHandoff || "承接上一段"}。
当前连续性：${unit.continuity || "保持人物身份、服装、场景、道具、轴线和视线一致"}。
每个时间段只突出一个主要动作。
${negative}`;
}

function completeVideoUnitReferences(units: AssetStoryboardVideoUnit[], shots: AssetStoryboardShot[], assets: ScriptAsset[]) {
    if (!units.length) return units;
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const singleSceneId = assets.filter((asset) => asset.type === "scene").length === 1 ? assets.find((asset) => asset.type === "scene")?.id || "" : "";
    const shotById = new Map(shots.map((shot) => [shot.id, shot]));
    let previousSceneId = "";
    let previousSceneChanged = false;
    return units.map((unit) => {
        const unitShots = unit.shotIds.map((shotId) => shotById.get(shotId)).filter((shot): shot is AssetStoryboardShot => Boolean(shot));
        const explicitSceneId = uniqueStrings(unitShots.flatMap((shot) => [shot.sceneAssetId || "", ...shot.assetIds])).find((id) => assetById.get(id)?.type === "scene" || unitShots.some((shot) => shot.sceneAssetId === id));
        const sceneChanged = previousSceneChanged || unitShots.some((shot) => shot.transitionBefore === "scene-change" || shot.transitionBefore === "time-jump");
        const sceneAssetId = explicitSceneId || (sceneChanged ? "" : previousSceneId || singleSceneId);
        const characterIdsFromNames = uniqueStrings(unitShots.flatMap((shot) => shot.characters.flatMap((name) => assets.filter((asset) => asset.type === "character" && (asset.name === name || asset.aliases.includes(name))).map((asset) => asset.id))));
        const characterIds = uniqueStrings([...unit.assetIds, ...characterIdsFromNames]).filter((id) => assetById.get(id)?.type === "character");
        const propIds = unit.assetIds.filter((id) => assetById.get(id)?.type === "prop");
        const remainingIds = unit.assetIds.filter((id) => !["character", "scene", "prop"].includes(String(assetById.get(id)?.type || "")));
        const unresolvedIds = unit.assetIds.filter((id) => !assetById.has(id));
        const assetIds = uniqueStrings([...characterIds, ...(sceneAssetId ? [sceneAssetId] : []), ...propIds, ...remainingIds, ...unresolvedIds]);
        if (sceneAssetId) previousSceneId = sceneAssetId;
        const lastTransition = unitShots.at(-1)?.transitionToNext;
        previousSceneChanged = lastTransition === "scene-change" || lastTransition === "time-jump";
        return { ...unit, sceneAssetId: sceneAssetId || undefined, assetIds };
    });
}

export function buildShotPrompt(shot: AssetStoryboardShot, assets: ScriptAsset[], source: CanvasNodeData) {
    const unit = createVideoUnit(1, [shot], shot.durationSec, shot.durationMode || "short", shot.durationSec);
    return buildVideoUnitPrompt(unit, [shot], assets, source);
}

export function buildVideoScriptOps(storyboard: CanvasNodeData, source: CanvasNodeData, state: AssetStoryboardState, assetNodes: CanvasNodeData[], existingNodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasAgentOp[] {
    const ops: CanvasAgentOp[] = [];
    const episodeId = state.episodeId || storyboard.metadata?.assetStoryboardEpisodeId;
    const units = state.videoUnits?.length ? state.videoUnits : state.shots.map((shot, index) => legacyVideoUnit(shot, index));
    const managed = existingNodes.filter((node) => node.type === CanvasNodeType.Video && node.metadata?.assetStoryboardSourceId === storyboard.id && (!episodeId || node.metadata?.assetStoryboardEpisodeId === episodeId));
    const existingByUnitId = new Map(managed.map((node) => [node.metadata?.assetStoryboardVideoUnitId, node]));
    const previewPool = managed.filter(isReusablePreviewNode).sort((left, right) => Number(left.metadata?.assetStoryboardShotIndex || 0) - Number(right.metadata?.assetStoryboardShotIndex || 0));
    const assetNodeByAssetId = new Map(assetNodes.map((node) => [node.metadata?.scriptAssetId, node]));
    const selectedIds: string[] = [];
    const reusedIds = new Set<string>();
    let previewIndex = 0;
    units.forEach((unit, index) => {
        if (!unit.finalPrompt) return;
        const unitMatched = existingByUnitId.get(unit.id);
        const poolNode = unitMatched ? undefined : previewPool[previewIndex];
        if (poolNode) previewIndex += 1;
        const old = unitMatched || poolNode;
        const id = old?.id || nanoid();
        if (old) reusedIds.add(old.id);
        selectedIds.push(id);
        const position = { x: storyboard.position.x + 360 + (index % 3) * 540, y: storyboard.position.y + Math.floor(index / 3) * 330 };
        const durationMode = unit.durationMode || state.durationMode || "short";
        const keyframeNodeIds = unit.keyframes?.filter((keyframe) => keyframe.status === "success" && keyframe.nodeId).map((keyframe) => keyframe.nodeId as string) || [];
        const referenceKeys = [...unit.assetIds, ...keyframeNodeIds];
        const status = old?.metadata?.content ? "success" as const : "idle" as const;
        const metadata = { prompt: unit.finalPrompt, composerContent: unit.finalPrompt, seconds: String(unit.durationSec), status, model: state.videoModel, assetStoryboardSourceId: storyboard.id, assetStoryboardEpisodeId: episodeId, assetStoryboardVideoUnitId: unit.id, assetStoryboardShotIds: unit.shotIds, assetStoryboardKeyframeIds: keyframeNodeIds, assetStoryboardShotId: unit.shotIds[0], assetStoryboardShotIndex: unit.index, assetStoryboardDurationMode: durationMode, assetStoryboardVideoModel: state.videoModel, assetStoryboardPreviewNode: !old?.metadata?.content, sourceNodeId: storyboard.id, references: referenceKeys, referenceOrder: referenceKeys };
        const title = `视频单元 ${String(unit.index).padStart(2, "0")} · ${unit.durationSec}秒 · ${durationModeLabel(durationMode)}`;
        if (old) ops.push({ type: "update_node", id, patch: { title, position, width: 420, height: 236 }, metadata });
        else ops.push({ type: "add_node", id, nodeType: CanvasNodeType.Video, title, position, width: 420, height: 236, metadata });
        if (!connections.some((connection) => connection.fromNodeId === storyboard.id && connection.toNodeId === id)) ops.push({ type: "connect_nodes", id: nanoid(), fromNodeId: storyboard.id, toNodeId: id });
        unit.assetIds.flatMap((assetId) => assetNodeByAssetId.get(assetId) || []).forEach((assetNode) => {
            if (!connections.some((connection) => connection.fromNodeId === assetNode.id && connection.toNodeId === id)) ops.push({ type: "connect_nodes", id: nanoid(), fromNodeId: assetNode.id, toNodeId: id });
        });
        keyframeNodeIds.forEach((keyframeNodeId) => {
            if (!existingNodes.some((node) => node.id === keyframeNodeId) || connections.some((connection) => connection.fromNodeId === keyframeNodeId && connection.toNodeId === id)) return;
            ops.push({ type: "connect_nodes", id: nanoid(), fromNodeId: keyframeNodeId, toNodeId: id });
        });
    });
    previewPool.filter((node) => !reusedIds.has(node.id)).forEach((node) => ops.push({ type: "delete_node", id: node.id }));
    ops.push({ type: "select_nodes", ids: selectedIds });
    return ops;
}

function createVideoUnit(index: number, shots: AssetStoryboardShot[], durationSec: number, durationMode: CanvasShotDurationMode, requiredDurationSec: number): AssetStoryboardVideoUnit {
    let cursor = 0;
    const segments: AssetStoryboardShotSegment[] = shots.map((shot, shotIndex) => {
        const startSec = cursor;
        cursor += shot.durationSec;
        return {
            id: `segment-${index}-${shotIndex + 1}`,
            shotId: shot.id,
            index: shotIndex + 1,
            startSec,
            endSec: cursor,
            title: shot.title,
            visualDescription: shot.visualDescription,
            shotSize: shot.shotSize,
            cameraMovement: shot.cameraMovement,
            dialogue: shot.dialogue,
            sound: shot.sound,
            startState: shot.startState,
            endState: shot.endState,
            continuity: shot.continuity,
            assetIds: shot.assetIds,
            dialogueLines: shot.dialogueLines,
            actionBeats: shot.actionBeats,
        };
    });
    if (segments.length && durationSec > requiredDurationSec) segments[segments.length - 1].endSec = durationSec;
    return {
        id: `video-unit-${index}`,
        index,
        title: shots.map((shot) => shot.title).filter(Boolean).join(" / ") || `视频单元 ${index}`,
        durationSec,
        durationMode,
        shotIds: shots.map((shot) => shot.id),
        segments,
        assetIds: uniqueStrings(shots.flatMap((shot) => shot.assetIds)),
        previousHandoff: shots[0]?.previousHandoff || "",
        startState: shots[0]?.startState || "",
        endState: shots.at(-1)?.endState || "",
        continuity: uniqueStrings(shots.map((shot) => shot.continuity).filter(Boolean)).join("；"),
        negativeConstraints: uniqueStrings(shots.flatMap((shot) => shot.negativeConstraints)),
        keyframes: buildVideoUnitKeyframes(index, shots),
        promptStatus: "idle",
    };
}

function legacyVideoUnit(shot: AssetStoryboardShot, index: number): AssetStoryboardVideoUnit {
    return createVideoUnit(index + 1, [shot], shot.durationSec, shot.durationMode || "short", shot.durationSec);
}

function legalVideoUnitDuration(requiredDurationSec: number, capabilities?: ShotDurationCapabilities | null) {
    const options = videoDurationOptions(capabilities);
    const minimum = options[0] || DEFAULT_MIN_DURATION_SECONDS;
    const maximum = options.at(-1) || DEFAULT_MAX_DURATION_SECONDS;
    const required = Math.max(minimum, Math.min(maximum, Math.round(Number(requiredDurationSec) || minimum)));
    const hasDiscreteOptions = Array.isArray(capabilities?.options) && (capabilities?.options || []).length > 0;
    if (!hasDiscreteOptions) return required;
    return options.find((value) => value >= required) || maximum;
}

function buildVideoUnitKeyframes(unitIndex: number, shots: AssetStoryboardShot[]) {
    const plans: AssetStoryboardKeyframePlan[] = [];
    const add = (kind: CanvasShotKeyframeKind, shot: AssetStoryboardShot, required: boolean) => {
        if (plans.some((plan) => plan.kind === kind && plan.sourceShotId === shot.id)) return;
        plans.push({
            id: `keyframe-${unitIndex}-${kind}-${shot.id}`,
            kind,
            sourceShotId: shot.id,
            title: keyframeKindLabel(kind),
            prompt: keyframePrompt(shot, kind),
            required,
            status: "planned",
        });
    };
    const first = shots[0];
    const last = shots.at(-1);
    if (first && (first.transitionBefore === "continuous" || first.needsKeyframe)) add("start", first, first.transitionBefore === "continuous");
    if (last && (last.transitionToNext === "continuous" || last.needsKeyframe)) add("end", last, last.transitionToNext === "continuous");
    for (let index = 0; index < shots.length - 1; index += 1) {
        const current = shots[index];
        const next = shots[index + 1];
        if (current.transitionToNext === "continuous" || next.needsKeyframe) {
            add("bridge", next, current.transitionToNext === "continuous");
            break;
        }
    }
    if (!plans.length && first?.needsKeyframe) add("action", first, false);
    return plans.slice(0, 1);
}

function keyframePrompt(shot: AssetStoryboardShot, kind: CanvasShotKeyframeKind) {
    const state = kind === "start"
        ? shot.startState
        : kind === "end"
          ? shot.endState
          : `${shot.startState || "当前动作状态"}过渡到${shot.endState || "动作结果状态"}`;
    return `画面无任何字幕。生成视频单元${keyframeKindLabel(kind)}参考图：${shot.keyframeDescription || shot.visualDescription}。${state ? `状态：${state}。` : ""}保持人物外观、服装、场景空间、道具、光线方向和镜头轴线一致。`;
}

function keyframeKindLabel(kind: CanvasShotKeyframeKind) {
    return kind === "start" ? "起始关键帧" : kind === "end" ? "结束关键帧" : kind === "bridge" ? "过渡关键帧" : kind === "scene" ? "场景关键帧" : "动作关键帧";
}

function splitShotForModel(shot: AssetStoryboardShot, modelMax: number): AssetStoryboardShot[] {
    if (shot.durationSec <= modelMax) return [shot];
    const partCount = Math.ceil(shot.durationSec / modelMax);
    const baseDuration = Math.floor(shot.durationSec / partCount);
    const remainder = shot.durationSec - baseDuration * partCount;
    const dialogueChunks = splitEvenly(shot.dialogueLines || [], partCount);
    const actionChunks = splitEvenly(shot.actionBeats || [], partCount);
    return Array.from({ length: partCount }, (_item, index) => {
        const durationSec = baseDuration + (index < remainder ? 1 : 0);
        const firstPart = index === 0;
        const lastPart = index === partCount - 1;
        return {
            ...shot,
            id: `${shot.id}-part-${index + 1}`,
            title: `${shot.title}（${index + 1}/${partCount}）`,
            durationSec,
            requiredDurationSec: durationSec,
            dialogueLines: dialogueChunks[index],
            actionBeats: actionChunks[index],
            startState: firstPart ? shot.startState : shot.continuity || "延续上一镜头动作状态",
            endState: lastPart ? shot.endState : "动作继续，作为下一时间段起点",
            transitionBefore: firstPart ? shot.transitionBefore : "continuous",
            transitionToNext: lastPart ? shot.transitionToNext : "continuous",
            needsKeyframe: shot.needsKeyframe && (firstPart || lastPart),
        };
    });
}

function splitEvenly<T>(items: T[], partCount: number) {
    const result = Array.from({ length: partCount }, () => [] as T[]);
    items.forEach((item, index) => result[Math.min(partCount - 1, Math.floor(index * partCount / Math.max(1, items.length)))].push(item));
    return result;
}

function transitionLabel(type: CanvasShotTransitionType) {
    return type === "continuous" ? "连续动作，保持姿态和空间衔接" : type === "hard-cut" ? "正常切镜，衔接空间关系" : type === "scene-change" ? "场景切换，保留人物状态" : type === "time-jump" ? "时间跳跃，明确环境变化" : type === "montage" ? "蒙太奇切镜" : type === "flashback" ? "闪回切镜" : "开场建立";
}

function randomUnitMode(key: string, firstDurationSec: number, modelMax: number): CanvasShotDurationMode {
    if (firstDurationSec > SHORT_VIDEO_UNIT_MAX_SECONDS) return "long";
    if (modelMax <= SHORT_VIDEO_UNIT_MAX_SECONDS) return "short";
    return randomDurationIndex(key, 2) === 0 ? "short" : "long";
}

function canMergeVideoShots(left: AssetStoryboardShot, right: AssetStoryboardShot) {
    if (left.endState && right.startState) return true;
    if (left.assetIds.length && right.assetIds.length) {
        const leftIds = new Set(left.assetIds);
        return right.assetIds.some((id) => leftIds.has(id));
    }
    return !left.assetIds.length || !right.assetIds.length;
}

function isReusablePreviewNode(node: CanvasNodeData) {
    return Boolean(node.metadata?.assetStoryboardPreviewNode || (node.metadata?.assetStoryboardSourceId && node.metadata?.status === "idle" && !node.metadata?.videoPhase))
        && !node.metadata?.content
        && !node.metadata?.videoTaskId
        && !node.metadata?.generationRequestId
        && !node.metadata?.videoProvider;
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
    return json.replace(/("shots"\s*:\s*)\[\s*index\s*"?\s*:/i, '$1[{"index":');
}

function stringOf(value: unknown, fallback = "") { return typeof value === "string" ? value.trim() : fallback; }
function arrayOfStrings(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : []; }
function uniqueStrings(values: string[]) { return Array.from(new Set(values.filter(Boolean))); }
function parseDialogueLines(value: unknown, fallback: string): AssetStoryboardDialogueLine[] {
    const items = Array.isArray(value) ? value : [];
    const lines = items.flatMap((item, index) => {
        const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
        const text = stringOf(source.text || item);
        if (!text) return [];
        const type = source.type === "voice-over" ? "voice-over" as const : "dialogue" as const;
        return [{ id: `dialogue-${index + 1}`, speaker: stringOf(source.speaker), text, type, durationSec: dialogueDuration(text) }];
    });
    if (lines.length) return lines;
    return fallback.split(/\n+|[；;]+/).map((text) => text.trim()).filter(Boolean).map((text, index) => {
        const match = text.match(/^([^：:]{1,16})[：:]\s*["“]?(.+?)["”]?$/);
        return { id: `dialogue-${index + 1}`, speaker: match?.[1] || "", text: match?.[2]?.trim() || text, type: /画外音|旁白|心声/.test(match?.[1] || text) ? "voice-over" as const : "dialogue" as const, durationSec: dialogueDuration(match?.[2]?.trim() || text) };
    });
}

function parseActionBeats(value: unknown, fallback: string): AssetStoryboardActionBeat[] {
    const items = Array.isArray(value) ? value : [];
    const beats = items.flatMap((item, index) => {
        const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
        const description = stringOf(source.description || item);
        return description ? [{ id: `action-${index + 1}`, description, durationSec: Math.max(0.8, Math.min(4, Number(source.durationSec) || 1.2)) }] : [];
    });
    return beats.length ? beats : fallback ? [{ id: "action-1", description: fallback, durationSec: 1.5 }] : [];
}

function dialogueDuration(text: string) {
    return Math.max(1.5, Math.round(((text.replace(/\s/g, "").length / 4.5) + 0.5) * 10) / 10);
}

function estimateShotDuration(dialogueLines: AssetStoryboardDialogueLine[], actionBeats: AssetStoryboardActionBeat[], suggestedDurationSec: number) {
    const dialogueDurationSec = dialogueLines.reduce((sum, line) => sum + line.durationSec, 0);
    const actionDurationSec = actionBeats.reduce((sum, beat) => sum + beat.durationSec, 0);
    const measured = dialogueDurationSec + actionDurationSec + (dialogueDurationSec && actionDurationSec ? 0.4 : 0);
    const fallback = Number.isFinite(suggestedDurationSec) && suggestedDurationSec > 0 ? suggestedDurationSec : 0;
    return Math.max(1, Math.ceil(Math.max(measured, fallback)));
}

function formatDialogueLine(line: AssetStoryboardDialogueLine) {
    const speaker = line.type === "voice-over" ? `画外音${line.speaker ? `·${line.speaker}` : ""}` : line.speaker || "角色";
    return `${speaker}：${line.text}`;
}
function shotTransitionType(value: unknown, fallback: CanvasShotTransitionType): CanvasShotTransitionType {
    const allowed: CanvasShotTransitionType[] = ["start", "continuous", "hard-cut", "scene-change", "time-jump", "montage", "flashback"];
    const text = String(value || "") as CanvasShotTransitionType;
    return allowed.includes(text) ? text : fallback;
}
function durationModeLabel(mode: CanvasShotDurationMode) { return mode === "long" ? "长镜头" : mode === "random" ? "随机" : "短镜头"; }
function randomDurationIndex(key: string, length: number) {
    let hash = 2166136261;
    for (let index = 0; index < key.length; index += 1) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
    return (hash >>> 0) % Math.max(1, length);
}
