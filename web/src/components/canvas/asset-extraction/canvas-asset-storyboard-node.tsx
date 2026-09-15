import { useEffect, useMemo, useRef, useState, type CSSProperties, type SyntheticEvent } from "react";
import { App, Button, Input, Modal, Segmented, Spin, Tag } from "antd";
import { Check, Clapperboard, Eye, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { nanoid } from "nanoid";

import { buildStoryboardAnalysisPrompt, buildVideoScriptOps, buildVideoUnitPrompt, buildVideoUnits, parseStoryboardAnalysis, videoDurationOptions, type ShotDurationCapabilities } from "@/lib/canvas/asset-storyboard";
import { assetExtractionContentHash } from "@/lib/canvas/asset-storyboard-draft";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { ScriptAsset } from "@/services/api/canvas-script";
import { canvasTextApi } from "@/services/api/canvas-text";
import { modelOptionName, useEffectiveConfig, videoCapabilitiesOf } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType, type AssetStoryboardState, type AssetStoryboardVideoUnit, type CanvasShotDurationMode } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

const STORYBOARD_ANALYSIS_TIMEOUT_MS = 120_000;
const DURATION_MODE_OPTIONS: Array<{ label: string; value: CanvasShotDurationMode }> = [
    { label: "短镜头", value: "short" },
    { label: "长镜头", value: "long" },
    { label: "随机", value: "random" },
];
const twoLineClampStyle = { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden", wordBreak: "break-word" } as CSSProperties;
const threeLineClampStyle = { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 3, overflow: "hidden", whiteSpace: "pre-wrap", wordBreak: "break-word" } as CSSProperties;

export function CanvasAssetStoryboardNode({ ctx }: { ctx: CanvasNodeContext }) {
    const { message } = App.useApp();
    const connection = useUserStore((state) => state.connection);
    const config = useEffectiveConfig();
    const [state, setState] = useState<AssetStoryboardState | null>(ctx.node.metadata?.assetStoryboard || null);
    const [expanded, setExpanded] = useState(false);
    const [allPromptsOpen, setAllPromptsOpen] = useState(false);
    const [promptUnit, setPromptUnit] = useState<AssetStoryboardVideoUnit | null>(null);
    const [analysisLoading, setAnalysisLoading] = useState(false);
    const [creatingVideos, setCreatingVideos] = useState(false);
    const ctxRef = useRef(ctx);
    const analysisAbortRef = useRef<AbortController | null>(null);
    const stateRef = useRef(state);
    const autoCreateVideosRef = useRef("");
    ctxRef.current = ctx;
    stateRef.current = state;

    useEffect(() => {
        const next = ctx.node.metadata?.assetStoryboard;
        if (next && next !== stateRef.current) {
            stateRef.current = next;
            setState(next);
        }
    }, [ctx.node.metadata?.assetStoryboard]);

    const source = useMemo(() => {
        const sourceId = ctx.node.metadata?.assetStoryboardSourceId;
        return (sourceId ? ctx.getNode(sourceId) : null) || ctx.getUpstream().find((node) => node.type === CanvasNodeType.AssetExtraction) || null;
    }, [ctx]);
    const episodeId = ctx.node.metadata?.assetStoryboardEpisodeId;
    const sourceContent = source && source.metadata?.assetExtractionEpisodeId === episodeId
        ? source.metadata?.content || ""
        : ctx.node.metadata?.assetStoryboardSourceContent || "";
    const episodeSource = useMemo(() => source ? { ...source, metadata: { ...source.metadata, content: sourceContent } } : null, [source, sourceContent]);
    const assetNodes = useMemo(() => ctx.getNodes().filter((node) => {
        if (node.type !== CanvasNodeType.ScriptAsset || node.metadata?.assetExtractionNodeId !== source?.id) return false;
        return !episodeId || !node.metadata?.scriptAssetEpisodeIds?.length || node.metadata.scriptAssetEpisodeIds.includes(episodeId);
    }), [ctx, episodeId, source?.id]);
    const catalog = useMemo<ScriptAsset[]>(() => assetNodes.map((node) => ({
        id: String(node.metadata?.scriptAssetId || node.id),
        type: node.metadata?.scriptAssetType || "prop",
        name: node.title,
        aliases: [],
        identity: {},
        visualDescription: node.metadata?.scriptAssetVisualDescription || "",
        imagePrompt: node.metadata?.scriptAssetImagePrompt || "",
        manuallyEdited: false,
        status: "active",
        mentionCount: 0,
        image: node.metadata?.content ? { id: String(node.metadata?.scriptAssetImageId || node.id), imageUrl: node.metadata.content, status: "success", selected: true } : null,
        variants: [],
    })), [assetNodes]);
    const videoCapabilities = useMemo(() => videoCapabilitiesOf(config, config.videoModel), [config]);
    const durationCapabilities = useMemo<ShotDurationCapabilities | null>(() => videoCapabilities?.duration || null, [videoCapabilities]);
    const durationOptions = useMemo(() => videoDurationOptions(durationCapabilities), [durationCapabilities]);
    const sourceHash = sourceContent ? assetExtractionContentHash(sourceContent) : "";
    const sourceEpisodeIsActive = !episodeId || source?.metadata?.assetExtractionEpisodeId === episodeId;
    const stale = Boolean(sourceEpisodeIsActive && sourceHash && state?.contentHash && sourceHash !== state.contentHash);
    const durationMode = state?.durationMode || "short";
    const units = state?.videoUnits || [];
    const promptDone = units.filter((unit) => Boolean(unit.finalPrompt)).length;
    const keyframeTotal = units.reduce((sum, unit) => sum + (unit.keyframes?.length || 0), 0);
    const keyframeDone = units.reduce((sum, unit) => sum + (unit.keyframes?.filter((keyframe) => keyframe.status === "success").length || 0), 0);
    const plannedKeyframeCount = units.reduce((sum, unit) => sum + (unit.keyframes?.filter((keyframe) => keyframe.status === "planned" || keyframe.status === "failed").length || 0), 0);
    const videoNodeCount = ctx.getNodes().filter((node) => node.type === CanvasNodeType.Video && node.metadata?.assetStoryboardSourceId === ctx.node.id && (!episodeId || node.metadata?.assetStoryboardEpisodeId === episodeId)).length;
    const canCreateVideos = Boolean(state?.status === "ready" && units.length && promptDone === units.length && units.every((unit) => unit.promptStatus === "success" && unit.finalPrompt));

    const saveState = (next: AssetStoryboardState) => {
        stateRef.current = next;
        setState(next);
        ctxRef.current.updateMetadata({ assetStoryboard: next, status: "idle", errorDetails: next.errorDetails });
    };

    const compileUnits = (shots: AssetStoryboardState["shots"], mode: CanvasShotDurationMode) => {
        if (!episodeSource) return [];
        const previous = stateRef.current?.videoUnits || [];
        const previousKeyframes = new Map(previous.flatMap((unit) => unit.keyframes || []).map((keyframe) => [`${keyframe.kind}:${keyframe.sourceShotId || ""}`, keyframe]));
        return buildVideoUnits(shots, mode, durationCapabilities, catalog).map((unit, index) => {
            const old = previous[index];
            const sameShots = Boolean(old && old.shotIds.length === unit.shotIds.length && old.shotIds.every((shotId, shotIndex) => shotId === unit.shotIds[shotIndex]));
            const keepLocked = Boolean(old?.locked && old.finalPrompt && sameShots && old.durationSec === unit.durationSec);
            const keyframes = unit.keyframes?.map((keyframe) => previousKeyframes.get(`${keyframe.kind}:${keyframe.sourceShotId || ""}`) || keyframe);
            const next = { ...unit, keyframes, finalPrompt: keepLocked ? old.finalPrompt : "" };
            return { ...next, finalPrompt: next.finalPrompt || buildVideoUnitPrompt(next, shots, catalog, episodeSource), promptStatus: "success" as const, promptError: undefined };
        });
    };

    const syncVideoPrompt = (unit: AssetStoryboardVideoUnit) => {
        const videoNode = ctx.getNodes().find((node) => node.type === CanvasNodeType.Video && node.metadata?.assetStoryboardSourceId === ctx.node.id && (node.metadata?.assetStoryboardVideoUnitId === unit.id || (!node.metadata?.content && !node.metadata?.videoTaskId && unit.shotIds.includes(String(node.metadata?.assetStoryboardShotId || "")))));
        if (!videoNode || videoNode.metadata?.prompt === unit.finalPrompt) return;
        ctx.applyOps([{ type: "update_node", id: videoNode.id, metadata: { prompt: unit.finalPrompt, composerContent: unit.finalPrompt, assetStoryboardVideoUnitId: unit.id, assetStoryboardShotIds: unit.shotIds, assetStoryboardShotId: unit.shotIds[0], status: videoNode.metadata?.content ? "success" : "idle" } }]);
    };

    const generateKeyframes = () => {
        const current = stateRef.current;
        if (!connection || !episodeSource || !current?.videoUnits?.length || !plannedKeyframeCount) return;
        Modal.confirm({
            title: "生成缺失的分镜参考图？",
            content: `当前有 ${plannedKeyframeCount} 张参考图待生成，本批先提交最多 4 张。普通切镜和场景切换不会生成多余首尾帧。`,
            okText: "开始生成",
            cancelText: "取消",
            centered: true,
            onOk: () => {
                const ops: CanvasAgentOp[] = [];
                let generatedIndex = 0;
                const batchSize = 4;
                const videoUnits = current.videoUnits?.map((unit) => ({
                    ...unit,
                    keyframes: unit.keyframes?.map((keyframe) => {
                        if (keyframe.status !== "planned" && keyframe.status !== "failed") return keyframe;
                        if (generatedIndex >= batchSize) return keyframe;
                        if (keyframe.status === "failed" && keyframe.nodeId) {
                            ops.push({ type: "update_node", id: keyframe.nodeId, metadata: { prompt: keyframe.prompt, status: "idle", errorDetails: undefined } });
                            ops.push({ type: "run_generation", nodeId: keyframe.nodeId, mode: "image", prompt: keyframe.prompt });
                            return { ...keyframe, status: "generating" as const, error: undefined };
                        }
                        const nodeId = nanoid();
                        const position = {
                            x: ctx.node.position.x + (generatedIndex % 3) * 380,
                            y: ctx.node.position.y + ctx.node.height + 96 + Math.floor(generatedIndex / 3) * 260,
                        };
                        generatedIndex += 1;
                        ops.push({
                            type: "add_node",
                            id: nodeId,
                            nodeType: CanvasNodeType.Image,
                            title: `${unit.title} · ${keyframe.title}`,
                            position,
                            width: 340,
                            height: 200,
                            metadata: {
                                prompt: keyframe.prompt,
                                status: "idle",
                                generationMode: "image",
                                model: config.imageModel,
                                size: config.size,
                                quality: config.quality,
                                sourceNodeId: ctx.node.id,
                                assetStoryboardSourceId: ctx.node.id,
                                assetStoryboardEpisodeId: episodeId,
                                assetStoryboardKeyframeId: keyframe.id,
                                assetStoryboardKeyframeKind: keyframe.kind,
                                assetStoryboardKeyframeUnitId: unit.id,
                            },
                        });
                        unit.assetIds.forEach((assetId) => {
                            const assetNode = assetNodes.find((node) => node.metadata?.scriptAssetId === assetId);
                            if (assetNode) ops.push({ type: "connect_nodes", id: nanoid(), fromNodeId: assetNode.id, toNodeId: nodeId });
                        });
                        ops.push({ type: "run_generation", nodeId, mode: "image", prompt: keyframe.prompt });
                        return { ...keyframe, nodeId, status: "generating" as const, error: undefined };
                    }),
                }));
                saveState({ ...current, videoUnits });
                ctx.applyOps(ops);
                const remaining = Math.max(0, plannedKeyframeCount - generatedIndex);
                message.success(remaining ? `已提交 ${generatedIndex} 张参考图，剩余 ${remaining} 张可继续生成` : `已提交 ${generatedIndex} 张参考图生成任务`);
            },
        });
    };

    useEffect(() => {
        const current = stateRef.current;
        if (!current?.videoUnits?.length || !episodeSource) return;
        let changed = false;
        const videoUnits = current.videoUnits.map((unit) => ({
            ...unit,
            keyframes: unit.keyframes?.map((keyframe) => {
                if (!keyframe.nodeId) return keyframe;
                const node = ctx.getNode(keyframe.nodeId);
                if (!node) return keyframe;
                const status = node.metadata?.content ? "success" : node.metadata?.status === "error" ? "failed" : node.metadata?.status === "loading" ? "generating" : keyframe.status;
                if (status === keyframe.status) return keyframe;
                changed = true;
                return { ...keyframe, status, error: node.metadata?.errorDetails };
            }),
        }));
        if (!changed) return;
        const recompiled = videoUnits.map((unit) => ({ ...unit, finalPrompt: unit.locked && unit.finalPrompt ? unit.finalPrompt : buildVideoUnitPrompt(unit, current.shots, catalog, episodeSource) }));
        saveState({ ...current, videoUnits: recompiled });
    }, [state, ctx, catalog, episodeSource]);

    useEffect(() => {
        const persisted = ctxRef.current.node.metadata?.assetStoryboard;
        if (!persisted || !["analyzing", "queued"].includes(persisted.status)) return;
        const recovered: AssetStoryboardState = { ...persisted, status: "error", errorDetails: "上次分镜分析未完成，请点击重新分析" };
        stateRef.current = recovered;
        setState(recovered);
        ctxRef.current.updateMetadata({ assetStoryboard: recovered, status: "idle", errorDetails: recovered.errorDetails });
    }, []);

    useEffect(() => () => analysisAbortRef.current?.abort(), []);

    const analyze = async () => {
        if (!connection || !episodeSource || analysisLoading) return;
        const content = episodeSource.metadata?.content?.trim();
        if (!content) return message.warning("资产提取正文为空");
        const previousState = stateRef.current;
        setAnalysisLoading(true);
        analysisAbortRef.current?.abort();
        const controller = new AbortController();
        analysisAbortRef.current = controller;
        const timeoutId = window.setTimeout(() => controller.abort(), STORYBOARD_ANALYSIS_TIMEOUT_MS);
        const working: AssetStoryboardState = { version: 1, sourceNodeId: episodeSource.id, episodeId, contentHash: assetExtractionContentHash(content), durationMode, videoModel: config.videoModel, status: "analyzing", title: "分镜脚本", totalDurationSec: 0, continuityBible: "", shots: [], videoUnits: [] };
        saveState(working);
        try {
            const result = await canvasTextApi.complete(connection, { requestId: nanoid(), input: [{ role: "user", content: buildStoryboardAnalysisPrompt(episodeSource, catalog, { durationMode, capabilities: durationCapabilities }) }], model: modelOptionName(episodeSource.metadata?.assetExtractionTextModel || config.textModel), maxOutputTokens: 12000 }, controller.signal);
            const parsed = parseStoryboardAnalysis(result.outputText, new Set(catalog.map((asset) => asset.id)), { durationMode, capabilities: durationCapabilities });
            const shots = parsed.shots.map((shot, index) => ({ ...shot, id: previousState?.shots[index]?.id || shot.id }));
            const videoUnits = compileUnits(shots, durationMode);
            autoCreateVideosRef.current = "";
            saveState({ ...working, ...parsed, durationMode, videoModel: config.videoModel, shots, videoUnits, status: "ready", totalDurationSec: videoUnits.reduce((sum, unit) => sum + unit.durationSec, 0) });
            message.success(`已拆分 ${shots.length} 个镜头，组装 ${videoUnits.length} 个视频单元`);
        } catch (error) {
            const reason = controller.signal.aborted ? "分镜分析超时或已中断，请点击重新分析" : readError(error);
            saveState({ ...working, status: "error", errorDetails: reason });
            message.error(reason);
        } finally {
            window.clearTimeout(timeoutId);
            if (analysisAbortRef.current === controller) analysisAbortRef.current = null;
            setAnalysisLoading(false);
        }
    };

    const regeneratePrompt = (unit: AssetStoryboardVideoUnit) => {
        const current = stateRef.current;
        if (!current || !episodeSource) return;
        const updated = { ...unit, finalPrompt: buildVideoUnitPrompt(unit, current.shots, catalog, episodeSource), promptStatus: "success" as const, promptError: undefined };
        saveState({ ...current, videoUnits: current.videoUnits?.map((item) => item.id === unit.id ? updated : item) });
        syncVideoPrompt(updated);
    };

    const createVideos = (notify = true) => {
        const current = stateRef.current;
        if (!current || !episodeSource || !canCreateVideos || creatingVideos) return;
        setCreatingVideos(true);
        try {
            const ops = buildVideoScriptOps(ctx.node, episodeSource, current, assetNodes, ctx.getNodes(), ctx.getConnections());
            if (ops.length) ctx.applyOps(ops);
            if (notify) message.success(`已更新 ${current.videoUnits?.length || 0} 个待生成视频节点`);
        } finally {
            setCreatingVideos(false);
        }
    };

    const changeDurationMode = (nextMode: CanvasShotDurationMode) => {
        const current = stateRef.current;
        if (!current || current.durationMode === nextMode) return;
        const videoUnits = compileUnits(current.shots, nextMode);
        autoCreateVideosRef.current = "";
        saveState({ ...current, durationMode: nextMode, videoModel: config.videoModel, videoUnits, totalDurationSec: videoUnits.reduce((sum, unit) => sum + unit.durationSec, 0) });
        message.success(`已切换为${durationModeLabel(nextMode)}`);
    };

    useEffect(() => {
        const current = stateRef.current;
        if (!current || current.status !== "ready" || stale || !episodeSource) return;
        const nextUnits = compileUnits(current.shots, current.durationMode || "short");
        const changed = nextUnits.length !== (current.videoUnits?.length || 0) || nextUnits.some((unit, index) => {
            const previous = current.videoUnits?.[index];
            return !previous || unit.durationSec !== previous.durationSec || unit.durationMode !== previous.durationMode || unit.finalPrompt !== previous.finalPrompt || unit.promptStatus !== previous.promptStatus;
        });
        if (changed) saveState({ ...current, videoUnits: nextUnits, videoModel: config.videoModel, totalDurationSec: nextUnits.reduce((sum, unit) => sum + unit.durationSec, 0) });
    }, [state, stale, episodeSource, catalog, durationCapabilities, config.videoModel]);

    useEffect(() => {
        if (!canCreateVideos || !state || stale || creatingVideos) return;
        const key = `${state.contentHash}:${state.durationMode || "short"}:${config.videoModel}:${durationOptions.join(",")}:${state.videoUnits?.map((unit) => `${unit.id}:${unit.durationSec}:${unit.keyframes?.filter((keyframe) => keyframe.status === "success" && keyframe.nodeId).map((keyframe) => keyframe.nodeId).join(",") || ""}`).join("|")}`;
        if (autoCreateVideosRef.current === key) return;
        autoCreateVideosRef.current = key;
        createVideos(false);
    }, [canCreateVideos, state, stale, creatingVideos, config.videoModel, durationOptions]);

    const stopCanvasInteraction = (event: SyntheticEvent) => event.stopPropagation();
    const status = analysisLoading || state?.status === "analyzing"
        ? "正在拆分镜头并组装视频单元..."
        : state?.status === "error"
            ? friendlyErrorMessage(state.errorDetails)
            : stale
              ? "正文已变化，请重新分析"
              : state
              ? `${state.shots.length} 个镜头 · ${units.length} 个视频单元 · 参考图 ${keyframeDone}/${keyframeTotal}`
                : "等待手动分析";

    return <>
        <div className="flex h-full w-full flex-col overflow-hidden" data-canvas-no-zoom style={{ color: ctx.theme.node.text, background: ctx.theme.node.panel, "--ant-color-bg-container": ctx.theme.node.panel, "--ant-color-border": ctx.theme.node.stroke } as CSSProperties} onWheel={stopCanvasInteraction}>
            <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.toolbar.panel }}>
                <span className="grid size-7 place-items-center rounded-md" style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.toolbar.activeText }}><Clapperboard className="size-4" /></span>
                <div className="min-w-0 flex-1"><div className="truncate text-[12px] font-semibold">分镜与视频单元</div><div className="truncate text-[10px]" style={{ color: stale || state?.status === "error" ? "#ef4444" : ctx.theme.node.muted }}>{status}</div></div>
                {state?.status === "ready" ? <Button type="text" size="small" icon={<Eye className="size-4" />} onClick={() => setExpanded(true)}>查看</Button> : null}
            </header>
            <div className="min-h-0 flex-1 p-3 text-[11px]" style={{ color: ctx.theme.node.muted }}>
                {analysisLoading ? <div className="grid h-full place-items-center gap-2"><Spin /><span>AI 正在拆分原子镜头并组装视频单元</span></div> : state?.status === "error" ? <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-red-400"><span>{friendlyErrorMessage(state.errorDetails)}</span><Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => void analyze()}>重新分析</Button></div> : units.length ? <div className="grid gap-2"><div className="flex items-center justify-between"><span>{state?.title}</span><Tag>{state?.totalDurationSec}秒</Tag></div><div className="flex items-center gap-1"><span className="h-1.5 flex-1 rounded bg-black/10"><span className="block h-full rounded bg-cyan-400" style={{ width: `${units.length ? promptDone / units.length * 100 : 0}%` }} /></span><span>{promptDone}/{units.length}</span></div><div>已组装 {units.length} 个视频单元，生成视频仍由用户在节点中手动触发。</div></div> : <div className="flex h-full flex-col items-center justify-center gap-2 text-center"><span>分镜节点已创建</span><Button type="primary" size="small" icon={<Sparkles className="size-3.5" />} loading={analysisLoading} onClick={() => void analyze()}>开始分析</Button></div>}
            </div>
        </div>
        <Modal open={expanded} onCancel={() => setExpanded(false)} footer={null} width="96vw" style={{ top: 18 }} styles={{ body: { padding: 0, height: "calc(100vh - 100px)" } }} title={<div className="flex items-center gap-2"><Clapperboard className="size-4" />{state?.title || "分镜与视频单元"}<Tag>{units.length} 个视频单元</Tag></div>}>
            <div className="flex h-full min-h-0 flex-col" data-canvas-no-zoom>
                <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2 text-xs" style={{ borderColor: ctx.theme.node.stroke }}>
                    <span>1 拆分原子镜头 {state?.status === "ready" ? <Check className="inline size-3 text-green-400" /> : null}</span>
                    <span>2 组装视频单元 {units.length}</span>
                    <span>3 拼接多时间段提示词 {promptDone}/{units.length}</span>
                    <span>4 参考图 {keyframeDone}/{keyframeTotal}</span>
                    <span className="ml-3 opacity-60">模型可选 {durationOptions[0]}-{durationOptions.at(-1)} 秒</span>
                    <Segmented size="small" value={durationMode} options={DURATION_MODE_OPTIONS} onChange={(value) => changeDurationMode(value as CanvasShotDurationMode)} />
                    <Button className="ml-auto" size="small" icon={<RefreshCw className="size-3.5" />} loading={analysisLoading} disabled={!stale && Boolean(state?.shots.length)} onClick={() => void analyze()}>重新分析</Button>
                </div>
                <div className="thin-scrollbar min-h-0 flex-1 overflow-auto p-3">
                    <table className="w-full min-w-[1460px] table-fixed border-collapse text-left text-xs">
                        <thead><tr className="border-b" style={{ borderColor: ctx.theme.node.stroke }}><th className="w-20 p-2">视频单元</th><th className="w-24 p-2">时长/模式</th><th className="w-[340px] p-2">内部时间段</th><th className="w-40 p-2">资产</th><th className="w-52 p-2">参考图计划</th><th className="w-[340px] p-2">最终提示词</th><th className="w-20 p-2">操作</th></tr></thead>
                        <tbody>{units.map((unit) => <tr key={unit.id} className="border-b align-top" style={{ borderColor: ctx.theme.node.stroke }}><td className="p-2 align-top font-semibold">单元 {String(unit.index).padStart(2, "0")}</td><td className="p-2 align-top"><div>{unit.durationSec}s</div><div className="text-[10px] opacity-55">{durationModeLabel(unit.durationMode)} · {unit.segments.length} 段</div></td><td className="p-2 align-top"><div className="space-y-1">{unit.segments.slice(0, 3).map((segment) => <div key={segment.id}>{segment.startSec}-{segment.endSec}秒：{segment.visualDescription}</div>)}{unit.segments.length > 3 ? <div className="opacity-55">还有 {unit.segments.length - 3} 个时间段，点击查看完整提示词</div> : null}</div></td><td className="p-2 align-top"><div style={twoLineClampStyle}>{unit.assetIds.map((id) => catalog.find((asset) => asset.id === id)?.name || id).join("、") || "无参考资产"}</div>{unit.sceneAssetId ? <div className="mt-1 text-[10px] text-green-400">场景参考已固定</div> : <div className="mt-1 text-[10px] text-red-400">缺少场景参考</div>}</td><td className="p-2 align-top">{unit.keyframes?.length ? <div className="space-y-1">{unit.keyframes.map((keyframe) => <div key={keyframe.id} className="flex items-center gap-1.5"><span className={`inline-block size-1.5 rounded-full ${keyframe.status === "success" ? "bg-green-400" : keyframe.status === "failed" ? "bg-red-400" : keyframe.status === "generating" ? "bg-amber-300" : "bg-slate-400"}`} /><span>{keyframe.title}</span><span className="opacity-55">{keyframeStatusLabel(keyframe.status)}</span></div>)}</div> : <span className="opacity-55">普通切镜，无需额外关键帧</span>}</td><td className="p-2 align-top">{unit.finalPrompt ? <button type="button" className="block w-full rounded border p-2 text-left text-[10px] leading-4 opacity-80" style={threeLineClampStyle} onClick={() => setPromptUnit(unit)}>{unit.finalPrompt}</button> : <span className="opacity-50">等待拼接</span>}</td><td className="p-2 align-top">{unit.finalPrompt ? <Button size="small" icon={<Eye className="size-3.5" />} onClick={() => setPromptUnit(unit)}>查看</Button> : <Button type="primary" size="small" icon={<Sparkles className="size-3.5" />} onClick={() => regeneratePrompt(unit)}>拼接</Button>}</td></tr>)}</tbody>
                    </table>
                </div>
                <div className="flex shrink-0 items-center gap-3 border-t px-4 py-3" style={{ borderColor: ctx.theme.node.stroke }}><span className="text-xs opacity-70">普通切镜不生成额外首尾帧；连续动作才生成智能参考图。每个视频单元只创建一个待生成节点，生成视频仍由用户手动触发。</span><Button className="ml-auto" disabled={!promptDone} onClick={() => setAllPromptsOpen(true)}>查看全部</Button><Button disabled={!plannedKeyframeCount} onClick={generateKeyframes}>生成参考图{plannedKeyframeCount ? ` ${plannedKeyframeCount}` : ""}</Button><Button type="primary" disabled={!canCreateVideos} loading={creatingVideos} icon={<LoaderCircle className="size-3.5" />} onClick={() => createVideos()}>{videoNodeCount ? "更新待生成节点" : "创建待生成节点"}</Button></div>
            </div>
        </Modal>
        <Modal open={Boolean(promptUnit)} onCancel={() => setPromptUnit(null)} footer={null} width="min(900px, 92vw)" title={`视频单元 ${promptUnit?.index || ""}：${promptUnit?.durationSec || 0}秒多时间段提示词`}><Input.TextArea value={promptUnit?.finalPrompt || ""} autoSize={{ minRows: 14, maxRows: 24 }} onChange={(event) => { if (!promptUnit || !state) return; const updated = { ...promptUnit, finalPrompt: event.target.value, locked: true }; const next = { ...state, videoUnits: state.videoUnits?.map((unit) => unit.id === promptUnit.id ? updated : unit) }; setPromptUnit(updated); saveState(next); }} onBlur={() => { const latest = promptUnit ? stateRef.current?.videoUnits?.find((unit) => unit.id === promptUnit.id) : null; if (latest) syncVideoPrompt(latest); }} /></Modal>
        <Modal open={allPromptsOpen} onCancel={() => setAllPromptsOpen(false)} footer={null} width="min(1100px, 92vw)" title="全部视频单元提示词"><div className="thin-scrollbar grid max-h-[72vh] gap-2 overflow-y-auto pr-1">{units.map((unit) => <details key={unit.id} className="rounded-lg border p-3 text-xs" style={{ borderColor: ctx.theme.node.stroke }}><summary className="cursor-pointer font-medium">单元 {unit.index} · {unit.durationSec}秒 · {durationModeLabel(unit.durationMode)} · {unit.segments.length} 段</summary><pre className="mt-3 whitespace-pre-wrap font-sans text-[11px] leading-5 opacity-80">{unit.finalPrompt || "尚未拼接"}</pre></details>)}</div></Modal>
    </>;
}

function durationModeLabel(mode: CanvasShotDurationMode) {
    return mode === "long" ? "长镜头" : mode === "random" ? "随机" : "短镜头";
}

function keyframeStatusLabel(status: "planned" | "generating" | "success" | "failed") {
    return status === "success" ? "已完成" : status === "generating" ? "生成中" : status === "failed" ? "失败" : "待生成";
}

function readError(error: unknown) {
    const value = error as { response?: { status?: number; data?: unknown }; message?: string };
    const data = parseErrorData(value.response?.data);
    const message = typeof data?.detail === "string"
        ? data.detail
        : typeof data?.message === "string"
          ? data.message
          : typeof data?.title === "string"
            ? data.title
            : value.message || "操作失败";
    return friendlyErrorMessage(`${value.response?.status === 504 ? "504 " : ""}${message}`);
}

function parseErrorData(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === "object") return value as Record<string, unknown>;
    if (typeof value !== "string") return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    } catch {
        return null;
    }
}

function friendlyErrorMessage(value?: string) {
    const text = String(value || "操作失败");
    if (/504|origin_gateway_timeout|Gateway time-out/i.test(text)) return "分镜服务响应超时，请等待约 2 分钟后重新分析";
    if (/timeout|timed out|超时/i.test(text)) return "分镜服务响应超时，请稍后重新分析";
    return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}
