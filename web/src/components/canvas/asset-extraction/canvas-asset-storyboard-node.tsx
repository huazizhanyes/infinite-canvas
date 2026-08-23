import { useEffect, useMemo, useRef, useState, type CSSProperties, type SyntheticEvent } from "react";
import { App, Button, Input, Modal, Spin, Tag } from "antd";
import { Check, Clapperboard, Eye, LoaderCircle, Play, RefreshCw, Sparkles, X } from "lucide-react";
import { nanoid } from "nanoid";

import { buildShotPrompt, buildStoryboardAnalysisPrompt, buildVideoScriptOps, parseStoryboardAnalysis } from "@/lib/canvas/asset-storyboard";
import { assetExtractionContentHash } from "@/lib/canvas/asset-storyboard-draft";
import { canvasTextApi } from "@/services/api/canvas-text";
import { modelOptionName, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType, type AssetStoryboardShot, type AssetStoryboardState, type CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

const activeStatuses = new Set(["queued", "pending", "running", "generating", "processing", "uploading"]);
const STORYBOARD_ANALYSIS_TIMEOUT_MS = 120_000;

export function CanvasAssetStoryboardNode({ ctx }: { ctx: CanvasNodeContext }) {
    const { message } = App.useApp();
    const connection = useUserStore((state) => state.connection);
    const config = useEffectiveConfig();
    const [state, setState] = useState<AssetStoryboardState | null>(ctx.node.metadata?.assetStoryboard || null);
    const [expanded, setExpanded] = useState(false);
    const [promptShot, setPromptShot] = useState<AssetStoryboardShot | null>(null);
    const [analysisLoading, setAnalysisLoading] = useState(false);
    const [creatingVideos, setCreatingVideos] = useState(false);
    const ctxRef = useRef(ctx);
    const analysisAbortRef = useRef<AbortController | null>(null);
    const stateRef = useRef(state);
    const promptRequestsRef = useRef(new Set<string>());
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
    const assetNodes = useMemo(() => ctx.getNodes().filter((node) => node.type === CanvasNodeType.ScriptAsset && node.metadata?.assetExtractionNodeId === source?.id), [ctx, source?.id]);
    const sourceHash = source?.metadata?.content ? assetExtractionContentHash(source.metadata.content) : "";
    const stale = Boolean(sourceHash && state?.contentHash && sourceHash !== state.contentHash);
    const promptDone = state?.shots.filter((shot) => Boolean(shot.finalPrompt)).length || 0;
    const canCreateVideos = Boolean(state?.status === "ready" && state.shots.length && promptDone === state.shots.length && state.shots.every((shot) => shot.promptStatus === "success" && shot.finalPrompt));

    const saveState = (next: AssetStoryboardState) => {
        stateRef.current = next;
        setState(next);
        // 分镜节点自己管理加载和错误界面，避免被通用生成节点重试逻辑接管。
        ctxRef.current.updateMetadata({ assetStoryboard: next, status: "idle", errorDetails: next.errorDetails });
    };

    useEffect(() => {
        const persisted = ctxRef.current.node.metadata?.assetStoryboard;
        if (!persisted) return;
        const analysisInterrupted = ["analyzing", "queued"].includes(persisted.status);
        const promptInterrupted = persisted.shots.some((shot) => shot.promptStatus === "generating");
        if (!analysisInterrupted && !promptInterrupted) return;
        const recovered: AssetStoryboardState = analysisInterrupted
            ? { ...persisted, status: "error", errorDetails: "上次分镜分析未完成，请点击重新分析" }
            : { ...persisted, status: "ready", shots: persisted.shots.map((shot) => shot.promptStatus === "generating" ? { ...shot, promptStatus: "idle", promptError: "上次生成已中断，请重试" } : shot) };
        stateRef.current = recovered;
        setState(recovered);
        ctxRef.current.updateMetadata({ assetStoryboard: recovered, status: "idle", errorDetails: recovered.errorDetails });
    }, []);

    useEffect(() => () => analysisAbortRef.current?.abort(), []);

    const analyze = async () => {
        if (!connection || !source || analysisLoading) return;
        const content = source.metadata?.content?.trim();
        if (!content) return message.warning("资产提取正文为空");
        setAnalysisLoading(true);
        analysisAbortRef.current?.abort();
        const controller = new AbortController();
        analysisAbortRef.current = controller;
        const timeoutId = window.setTimeout(() => controller.abort(), STORYBOARD_ANALYSIS_TIMEOUT_MS);
        const working: AssetStoryboardState = { version: 1, sourceNodeId: source.id, contentHash: assetExtractionContentHash(content), status: "analyzing", title: "分镜脚本", totalDurationSec: 0, continuityBible: "", shots: [] };
        saveState(working);
        try {
            const catalog = assetNodes.map((node) => ({ id: String(node.metadata?.scriptAssetId || node.id), type: node.metadata?.scriptAssetType || "prop", name: node.title, aliases: [], identity: {}, visualDescription: node.metadata?.scriptAssetVisualDescription || "", imagePrompt: node.metadata?.scriptAssetImagePrompt || "", manuallyEdited: false, status: "active", mentionCount: 0, image: node.metadata?.content ? { id: String(node.metadata?.scriptAssetImageId || node.id), imageUrl: node.metadata.content, status: "success", selected: true } : null, variants: [] }));
            const result = await canvasTextApi.complete(connection, { requestId: nanoid(), input: [{ role: "user", content: buildStoryboardAnalysisPrompt(source, catalog) }], model: modelOptionName(source.metadata?.assetExtractionTextModel || config.textModel), maxOutputTokens: 12000 }, controller.signal);
            const parsed = parseStoryboardAnalysis(result.outputText, new Set(catalog.map((asset) => asset.id)));
            saveState({ ...working, ...parsed, status: "ready" });
            message.success(`已拆分 ${parsed.shots.length} 个分镜`);
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

    const generatePrompt = async (shot: AssetStoryboardShot) => {
        const currentState = stateRef.current;
        const currentShot = currentState?.shots.find((item) => item.id === shot.id) || shot;
        if (!connection || !source || !currentState || currentShot.promptStatus === "generating" || promptRequestsRef.current.has(shot.id)) return;
        promptRequestsRef.current.add(shot.id);
        const nextShots = currentState.shots.map((item) => item.id === shot.id ? { ...item, promptStatus: "generating" as const, promptError: undefined } : item);
        const working = { ...currentState, shots: nextShots };
        saveState(working);
        try {
            const catalog = assetNodes.map((node) => ({ id: String(node.metadata?.scriptAssetId || node.id), type: node.metadata?.scriptAssetType || "prop", name: node.title, aliases: [], identity: {}, visualDescription: node.metadata?.scriptAssetVisualDescription || "", imagePrompt: node.metadata?.scriptAssetImagePrompt || "", manuallyEdited: false, status: "active", mentionCount: 0, image: null, variants: [] }));
            const result = await canvasTextApi.complete(connection, { requestId: nanoid(), input: [{ role: "user", content: `请把下面这条已拆好的分镜整理成最终视频提示词。只输出提示词正文，不要解释。\n\n${buildShotPrompt(currentShot, catalog, source)}` }], model: modelOptionName(source.metadata?.assetExtractionTextModel || config.textModel), maxOutputTokens: 4000 });
            const completed = { ...currentShot, finalPrompt: result.outputText.trim(), promptStatus: "success" as const, promptError: undefined };
            const latest = stateRef.current || working;
            saveState({ ...latest, shots: latest.shots.map((item) => item.id === shot.id ? completed : item) });
            message.success(`分镜 ${shot.index} 提示词已生成`);
        } catch (error) {
            const reason = readError(error);
            const latest = stateRef.current || working;
            saveState({ ...latest, shots: latest.shots.map((item) => item.id === shot.id ? { ...item, promptStatus: "error" as const, promptError: reason } : item) });
            message.error(reason);
        } finally {
            promptRequestsRef.current.delete(shot.id);
        }
    };

    const createVideos = () => {
        if (!state || !source || !canCreateVideos || creatingVideos) return;
        setCreatingVideos(true);
        try {
            const ops = buildVideoScriptOps(ctx.node, source, state, assetNodes, ctx.getNodes(), ctx.getConnections());
            ctx.applyOps(ops);
            message.success(`已创建 ${state.shots.length} 个视频脚本节点`);
        } finally {
            setCreatingVideos(false);
        }
    };

    const stopCanvasInteraction = (event: SyntheticEvent) => event.stopPropagation();
    const status = analysisLoading || state?.status === "analyzing" ? "正在分析分镜..." : stale ? "正文已变化，请重新分析" : state?.status === "error" ? state.errorDetails || "分析失败" : state ? `${state.shots.length} 个镜头 · 提示词 ${promptDone}/${state.shots.length}` : "等待生成分镜";

    return <>
        <div className="flex h-full w-full flex-col overflow-hidden" data-canvas-no-zoom style={{ color: ctx.theme.node.text, background: ctx.theme.node.panel, "--ant-color-bg-container": ctx.theme.node.panel, "--ant-color-border": ctx.theme.node.stroke } as CSSProperties} onPointerDown={stopCanvasInteraction} onWheel={stopCanvasInteraction}>
            <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.toolbar.panel }}>
                <span className="grid size-7 place-items-center rounded-md" style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.toolbar.activeText }}><Clapperboard className="size-4" /></span>
                <div className="min-w-0 flex-1"><div className="truncate text-[12px] font-semibold">资产专属分镜</div><div className="truncate text-[10px]" style={{ color: stale || state?.status === "error" ? "#ef4444" : ctx.theme.node.muted }}>{status}</div></div>
                {state?.status === "ready" ? <Button type="text" size="small" icon={<Eye className="size-4" />} onClick={() => setExpanded(true)}>查看分镜</Button> : null}
            </header>
            <div className="min-h-0 flex-1 p-3 text-[11px]" style={{ color: ctx.theme.node.muted }}>
                {analysisLoading ? <div className="grid h-full place-items-center gap-2"><Spin /><span>AI 正在按剧情拆分 5-15 秒镜头</span></div> : state?.status === "error" ? <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-red-400"><span>{state.errorDetails}</span><Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => void analyze()}>重新分析</Button></div> : state?.shots.length ? <div className="grid gap-2"><div className="flex items-center justify-between"><span>{state.title}</span><Tag>{state.totalDurationSec}秒</Tag></div><div className="flex items-center gap-1"><span className="h-1.5 flex-1 rounded bg-black/10"><span className="block h-full rounded bg-cyan-400" style={{ width: `${state.shots.length ? promptDone / state.shots.length * 100 : 0}%` }} /></span><span>{promptDone}/{state.shots.length}</span></div></div> : <div className="flex h-full flex-col items-center justify-center gap-2 text-center"><span>分镜节点已创建</span><Button type="primary" size="small" icon={<Sparkles className="size-3.5" />} loading={analysisLoading} onClick={() => void analyze()}>开始分析</Button></div>}
            </div>
        </div>
        <Modal open={expanded} onCancel={() => setExpanded(false)} footer={null} width="96vw" style={{ top: 18 }} styles={{ body: { padding: 0, height: "calc(100vh - 100px)" } }} title={<div className="flex items-center gap-2"><Clapperboard className="size-4" />{state?.title || "分镜脚本"}<Tag>{state?.shots.length || 0} 镜头</Tag></div>}>
            <div className="flex h-full min-h-0 flex-col" data-canvas-no-zoom>
                <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2 text-xs" style={{ borderColor: ctx.theme.node.stroke }}><span>1 分析分镜 {state?.status === "ready" ? <Check className="inline size-3 text-green-400" /> : null}</span><span>2 生成提示词 {promptDone}/{state?.shots.length || 0}</span><span>3 创建视频脚本</span><Button className="ml-auto" size="small" icon={<RefreshCw className="size-3.5" />} loading={analysisLoading} disabled={!stale && Boolean(state?.shots.length)} onClick={() => void analyze()}>重新分析</Button></div>
                <div className="thin-scrollbar min-h-0 flex-1 overflow-auto p-3"><table className="w-full min-w-[1200px] border-collapse text-left text-xs"><thead><tr className="border-b" style={{ borderColor: ctx.theme.node.stroke }}><th className="p-2">镜号</th><th className="p-2">时长</th><th className="p-2 min-w-[360px]">画面描述</th><th className="p-2">景别</th><th className="p-2 min-w-[220px]">对白/音效</th><th className="p-2 min-w-[320px]">最终提示词</th><th className="p-2">操作</th></tr></thead><tbody>{state?.shots.map((shot) => <tr key={shot.id} className="border-b align-top" style={{ borderColor: ctx.theme.node.stroke }}><td className="p-2 font-semibold">{shot.index}</td><td className="p-2">{shot.durationSec}s</td><td className="p-2"><div className="font-medium">{shot.title}</div><div className="mt-1 opacity-75">{shot.visualDescription}</div><div className="mt-1 text-[10px] opacity-60">依据：{shot.sourceExcerpt}</div></td><td className="p-2">{shot.shotSize}<br /><span className="opacity-60">{shot.cameraMovement}</span></td><td className="p-2">{shot.dialogue || "无对白"}<br /><span className="opacity-60">{shot.sound || "环境音"}</span></td><td className="p-2">{shot.finalPrompt ? <button type="button" className="max-h-28 w-full overflow-auto whitespace-pre-wrap rounded border p-2 text-left" onClick={() => setPromptShot(shot)}>{shot.finalPrompt}</button> : <span className="opacity-50">尚未生成</span>}</td><td className="p-2">{shot.finalPrompt ? <Button size="small" icon={<Eye className="size-3.5" />} onClick={() => setPromptShot(shot)}>查看提示词</Button> : <Button type="primary" size="small" loading={shot.promptStatus === "generating"} icon={<Sparkles className="size-3.5" />} onClick={() => void generatePrompt(shot)}>生成提示词</Button>}</td></tr>)}</tbody></table></div>
                <div className="flex shrink-0 items-center gap-3 border-t px-4 py-3" style={{ borderColor: ctx.theme.node.stroke }}><span className="text-xs opacity-70">提示词完成 {promptDone}/{state?.shots.length || 0}</span><Button className="ml-auto" type="primary" disabled={!canCreateVideos} loading={creatingVideos} icon={<Play className="size-3.5" />} onClick={createVideos}>创建视频脚本节点</Button></div>
            </div>
        </Modal>
        <Modal open={Boolean(promptShot)} onCancel={() => setPromptShot(null)} footer={null} width="min(900px, 92vw)" title={`第 ${promptShot?.index || ""} 镜：最终提示词`}><Input.TextArea value={promptShot?.finalPrompt || ""} autoSize={{ minRows: 14, maxRows: 24 }} onChange={(event) => { if (!promptShot || !state) return; const next = { ...state, shots: state.shots.map((shot) => shot.id === promptShot.id ? { ...shot, finalPrompt: event.target.value, locked: true } : shot) }; setPromptShot({ ...promptShot, finalPrompt: event.target.value, locked: true }); saveState(next); }} /></Modal>
    </>;
}

function readError(error: unknown) {
    const value = error as { response?: { data?: { message?: string } }; message?: string };
    return value.response?.data?.message || value.message || "操作失败";
}
