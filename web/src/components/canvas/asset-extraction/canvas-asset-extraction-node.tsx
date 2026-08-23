import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from "react";
import { App, Button, Modal, Select, Tag } from "antd";
import { Boxes, Clapperboard, ImagePlus, LoaderCircle, RectangleHorizontal, RefreshCw, Sparkles } from "lucide-react";
import { nanoid } from "nanoid";

import { waitForAssetAnalysis, waitForAssetImages } from "@/components/canvas/asset-extraction/asset-extraction-tasks";
import { ModelPicker } from "@/components/model-picker";
import { CanvasQuoteDisplay } from "@/components/canvas/canvas-quote-display";
import { buildAssetExtractionOps, generationImageMetadata } from "@/lib/canvas/asset-extraction-layout";
import { assetExtractionContentHash } from "@/lib/canvas/asset-storyboard-draft";
import { ASSET_IMAGE_STATE_CHANGED_EVENT, inspectAssetReadiness } from "@/lib/canvas/asset-storyboard";
import { canvasBillingApi, canvasCompactQuoteLabel, type CanvasBillingQuote } from "@/services/api/canvas-billing";
import { canvasScriptApi, type ScriptAsset, type ScriptGenerationImage, type ScriptPendingMention } from "@/services/api/canvas-script";
import { modelOptionName, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

export function CanvasAssetExtractionNode({ ctx }: { ctx: CanvasNodeContext }) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const connection = useUserStore((state) => state.connection);
    const scriptSetId = ctx.node.metadata?.scriptSetId;
    const episodeId = ctx.node.metadata?.assetExtractionEpisodeId;
    const [content, setContent] = useState(ctx.node.metadata?.content || "");
    const [visualStyle, setVisualStyle] = useState(ctx.node.metadata?.assetExtractionVisualStyle || "3D漫风格");
    const [textModel, setTextModel] = useState(ctx.node.metadata?.assetExtractionTextModel || config.textModel);
    const [imageModel, setImageModel] = useState(ctx.node.metadata?.assetExtractionImageModel || config.imageModel);
    const [aspectRatio, setAspectRatio] = useState(ctx.node.metadata?.assetExtractionAspectRatio || "16:9");
    const [imageQuality, setImageQuality] = useState(ctx.node.metadata?.assetExtractionImageQuality || "standard");
    const [assets, setAssets] = useState<ScriptAsset[]>([]);
    const [pending, setPending] = useState<ScriptPendingMention[]>([]);
    const [pendingOpen, setPendingOpen] = useState(false);
    const analyzing = ctx.node.metadata?.assetExtractionStatus === "analyzing";
    const [generating, setGenerating] = useState(false);
    const [quote, setQuote] = useState<CanvasBillingQuote | null>(null);
    const [quoteState, setQuoteState] = useState<"idle" | "loading" | "ready" | "error">("idle");
    const [quoteError, setQuoteError] = useState("");
    const [quoteRequestId, setQuoteRequestId] = useState(() => nanoid());
    const [, setReadinessRevision] = useState(0);
    const ctxRef = useRef(ctx);
    const resumedAnalysisRef = useRef<string | undefined>(undefined);
    const resumedImageBatchesRef = useRef(new Set<string>());
    ctxRef.current = ctx;
    const quoteKey = `${assets.length}:${modelOptionName(imageModel)}:${aspectRatio}:${imageQuality}`;

    useEffect(() => {
        setQuote(null);
        setQuoteState("idle");
        setQuoteError("");
        setQuoteRequestId(nanoid());
    }, [quoteKey]);

    useEffect(() => ctx.on(ASSET_IMAGE_STATE_CHANGED_EVENT, (payload) => {
        if ((payload as { sourceId?: string } | undefined)?.sourceId === ctx.node.id) setReadinessRevision((value) => value + 1);
    }), [ctx]);

    useEffect(() => {
        if (!connection || !assets.length) return;
        const controller = new AbortController();
        setQuoteState("loading");
        setQuoteError("");
        void canvasBillingApi.quote(connection, {
            feature: "canvas.asset.image.generate",
            requestId: quoteRequestId,
            model: modelOptionName(imageModel),
            count: assets.length,
            size: imageSizeForAspect(aspectRatio),
            quality: imageQuality,
            outputFormat: "png",
        }, controller.signal).then((value) => {
            setQuote(value);
            setQuoteState("ready");
        }).catch((error) => {
            if (controller.signal.aborted) return;
            setQuote(null);
            setQuoteState("error");
            setQuoteError(readError(error));
        });
        return () => controller.abort();
    }, [aspectRatio, assets.length, connection, imageModel, imageQuality, quoteRequestId]);

    const placeAssets = useCallback(
        (nextAssets: ScriptAsset[]) => {
            const current = ctxRef.current;
            const source = current.getNode(current.node.id) || current.node;
            const ops = buildAssetExtractionOps(source, nextAssets, current.getNodes(), current.getConnections());
            if (ops.length) current.applyOps(ops);
        },
        [],
    );

    const loadAssets = useCallback(async () => {
        if (!connection || !scriptSetId) return;
        const data = await canvasScriptApi.listAssets(connection, scriptSetId);
        setAssets(data.assets);
        setPending(data.pending);
        placeAssets(data.assets);
        ctxRef.current.updateMetadata({ assetExtractionAssetCount: data.assets.length, assetExtractionPendingCount: data.pending.length });
        return data;
    }, [connection, placeAssets, scriptSetId]);

    useEffect(() => {
        if (!scriptSetId || !connection) return;
        void loadAssets().catch(() => undefined);
    }, [connection, loadAssets, scriptSetId]);

    useEffect(() => {
        const runId = ctx.node.metadata?.assetExtractionRunId;
        if (!connection || !runId || !analyzing || resumedAnalysisRef.current === runId) return;
        resumedAnalysisRef.current = runId;
        void waitForAssetAnalysis(connection, runId)
            .then(async (run) => {
                if (run.status !== "succeeded") throw new Error(run.error || "资产提取失败");
                const data = await loadAssets();
                ctxRef.current.updateMetadata({ assetExtractionStatus: "success", assetExtractionAssetCount: data?.assets.length || 0, assetExtractionPendingCount: data?.pending.length || 0, assetExtractionUpdatedAt: Date.now() });
            })
            .catch((error) => ctxRef.current.updateMetadata({ assetExtractionStatus: "error", errorDetails: readError(error) }));
    }, [analyzing, connection, ctx.node.metadata?.assetExtractionRunId, loadAssets]);

    const runAnalyze = async (clearExisting: boolean) => {
        if (!connection || !scriptSetId || !episodeId || analyzing) return;
        if (!content.trim()) {
            message.warning("请先输入小说或文案");
            return;
        }
        if (clearExisting && assets.length) {
            try {
                await canvasScriptApi.archiveAssets(connection, scriptSetId);
                const managedIds = ctxRef.current.getNodes()
                    .filter((node) => node.type === CanvasNodeType.ScriptAsset && node.metadata?.assetExtractionNodeId === ctx.node.id)
                    .map((node) => node.id);
                if (managedIds.length) ctxRef.current.applyOps([{ type: "delete_node", ids: managedIds }]);
                setAssets([]);
                setPending([]);
            } catch (error) {
                message.error(`清空现有资产失败：${readError(error)}`);
                return;
            }
        }
        ctx.updateMetadata({
            content,
            assetExtractionContentHash: assetExtractionContentHash(content),
            assetExtractionVisualStyle: visualStyle,
            assetExtractionTextModel: textModel,
            assetExtractionImageModel: imageModel,
            assetExtractionAspectRatio: aspectRatio,
            assetExtractionImageQuality: imageQuality,
            assetExtractionRunId: undefined,
            assetExtractionStatus: "analyzing",
            errorDetails: undefined,
        });
        try {
            await Promise.all([
                canvasScriptApi.updateSet(connection, scriptSetId, { visualStyle, aspectRatio, imageQuality }),
                canvasScriptApi.updateEpisode(connection, episodeId, { title: ctx.node.title, content }),
            ]);
            const started = await canvasScriptApi.analyzeEpisode(connection, episodeId, nanoid(), modelOptionName(textModel));
            resumedAnalysisRef.current = started.id;
            ctx.updateMetadata({ assetExtractionRunId: started.id });
            const run = await waitForAssetAnalysis(connection, started.id);
            if (run.status !== "succeeded") throw new Error(run.error || "资产提取失败");
            const data = await loadAssets();
            ctx.updateMetadata({
                assetExtractionStatus: "success",
                assetExtractionAssetCount: data?.assets.length || 0,
                assetExtractionPendingCount: data?.pending.length || 0,
                assetExtractionUpdatedAt: Date.now(),
            });
            message.success(`已提取 ${data?.assets.length || 0} 个资产`);
        } catch (error) {
            const reason = readError(error);
            ctx.updateMetadata({ assetExtractionStatus: "error", errorDetails: reason });
            message.error(reason);
        }
    };

    const analyze = () => {
        if (!assets.length) {
            void runAnalyze(false);
            return;
        }
        Modal.confirm({
            title: "确认重新提取资产？",
            content: `当前已有 ${assets.length} 个资产。继续后会清空现有资产并按最新正文重新提取。`,
            okText: "清空并提取",
            cancelText: "取消",
            centered: true,
            onOk: () => runAnalyze(true),
        });
    };

    const applyImages = useCallback(
        (images: ScriptGenerationImage[], _batchId: string) => {
            const nodes = ctx.getNodes();
            const ops = images.flatMap((image) => {
                const node = nodes.find((item) => item.type === CanvasNodeType.ScriptAsset && item.metadata?.assetExtractionNodeId === ctx.node.id && item.metadata?.scriptAssetId === image.assetId);
                return node ? [{ type: "update_node" as const, id: node.id, metadata: generationImageMetadata(image, _batchId) }] : [];
            });
            if (ops.length) ctx.applyOps(ops);
        },
        [ctx],
    );

    useEffect(() => {
        if (!connection) return;
        (ctx.node.metadata?.assetExtractionImageBatchIds || []).forEach((batchId) => {
            if (resumedImageBatchesRef.current.has(batchId)) return;
            resumedImageBatchesRef.current.add(batchId);
            setGenerating(true);
            void waitForAssetImages(connection, batchId, (batch) => applyImages(batch.images, batch.id))
                .then(() => loadAssets())
                .catch((error) => message.error(readError(error)))
                .finally(() => {
                    const remaining = (ctxRef.current.node.metadata?.assetExtractionImageBatchIds || []).filter((id) => id !== batchId);
                    ctxRef.current.updateMetadata({ assetExtractionImageBatchIds: remaining });
                    setGenerating(Boolean(remaining.length));
                });
        });
    }, [applyImages, connection, ctx.node.metadata?.assetExtractionImageBatchIds, loadAssets, message]);

    const generateAll = async () => {
        if (!connection || !scriptSetId || !assets.length || generating) return;
        setGenerating(true);
        try {
            await canvasScriptApi.updateSet(connection, scriptSetId, { visualStyle, aspectRatio, imageQuality });
            for (let offset = 0; offset < assets.length; offset += 50) {
                const targets = assets.slice(offset, offset + 50).map((asset) => ({ assetId: asset.id }));
                const requestId = nanoid();
                const batchQuote = await canvasBillingApi.quote(connection, {
                    feature: "canvas.asset.image.generate",
                    requestId,
                    model: modelOptionName(imageModel),
                    count: targets.length,
                    size: imageSizeForAspect(aspectRatio),
                    quality: imageQuality,
                    outputFormat: "png",
                });
                if (!batchQuote?.canSubmit) throw new Error("图片余额不足，请先充值或调整账户权益");
                const batch = await canvasScriptApi.generateAssets(connection, scriptSetId, targets, requestId, modelOptionName(imageModel), batchQuote.quoteToken);
                resumedImageBatchesRef.current.add(batch.id);
                ctx.updateMetadata({ assetExtractionImageBatchIds: [batch.id] });
                applyImages(batch.images, batch.id);
                const completed = await waitForAssetImages(connection, batch.id, (current) => applyImages(current.images, current.id));
                ctx.updateMetadata({ assetExtractionImageBatchIds: [] });
                if (completed.failedCount) message.warning(`本批图片成功 ${completed.successCount} 张，失败 ${completed.failedCount} 张`);
            }
            await loadAssets();
            message.success("资产图片生成完成");
        } catch (error) {
            ctx.updateMetadata({ assetExtractionImageBatchIds: [] });
            message.error(readError(error));
        } finally {
            setGenerating(false);
            setQuoteRequestId(nanoid());
        }
    };

    const createStoryboardDraft = () => {
        const current = ctxRef.current;
        const source = current.getNode(current.node.id) || current.node;
        const readiness = inspectAssetReadiness(source, assets, current.getNodes(), pending.length, assetExtractionContentHash(content));
        if (!readiness.ready) {
            message.warning(readiness.reason);
            return;
        }
        const existing = current.getNodes().find((node) => node.type === CanvasNodeType.AssetStoryboard && node.metadata?.assetStoryboardSourceId === source.id);
        if (existing) {
            current.applyOps([{ type: "select_nodes", ids: [existing.id] }]);
            message.info("已存在资产专属分镜节点");
            return;
        }
        const id = nanoid();
        current.applyOps([
            { type: "add_node", id, nodeType: CanvasNodeType.AssetStoryboard, title: "资产专属分镜", position: { x: source.position.x + source.width + 96, y: source.position.y + source.height + 96 }, width: 300, height: 180, metadata: { assetStoryboardSourceId: source.id, status: "loading" } },
            { type: "connect_nodes", id: nanoid(), fromNodeId: source.id, toNodeId: id },
            { type: "select_nodes", ids: [id] },
        ]);
        message.success("已创建资产专属分镜节点");
    };

    const sourceContentChanged = Boolean(content.trim() && ctx.node.metadata?.assetExtractionContentHash && assetExtractionContentHash(content) !== ctx.node.metadata.assetExtractionContentHash);
    const storyboardReadiness = inspectAssetReadiness(ctx.node, assets, ctx.getNodes(), pending.length, assetExtractionContentHash(content));

    const resolvePending = async (item: ScriptPendingMention, decision: "reuse" | "variant" | "new") => {
        if (!connection) return;
        try {
            await canvasScriptApi.resolveMention(connection, item.id, decision, decision === "new" ? undefined : item.suggestedAsset?.id);
            const data = await loadAssets();
            if (!data?.pending.length) setPendingOpen(false);
        } catch (error) {
            message.error(readError(error));
        }
    };

    const stopCanvasInteraction = (event: SyntheticEvent) => event.stopPropagation();
    const statusText = analyzing ? "正在分析资产..." : ctx.node.metadata?.assetExtractionStatus === "error" ? ctx.node.metadata.errorDetails || "提取失败" : `${ctx.node.metadata?.assetExtractionAssetCount || assets.length} 个资产${pending.length ? ` · ${pending.length} 项待确认` : ""}`;

    return (
        <div
            className="flex h-full w-full flex-col overflow-hidden"
            style={{ color: ctx.theme.node.text, background: ctx.theme.node.panel, "--ant-color-bg-container": ctx.theme.node.panel, "--ant-color-border": ctx.theme.node.stroke } as CSSProperties}
            data-canvas-no-zoom
        >
            <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.toolbar.panel }}>
                <span className="grid size-8 place-items-center rounded-md" style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.toolbar.activeText }}><Boxes className="size-4" /></span>
                <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold">资产提取</div>
                    <div className="truncate text-[11px]" style={{ color: ctx.node.metadata?.assetExtractionStatus === "error" ? "#ef4444" : ctx.theme.node.muted }}>{statusText}</div>
                </div>
                <Button type="text" size="small" icon={<RefreshCw className="size-4" />} title="刷新资产" aria-label="刷新资产" onMouseDown={stopCanvasInteraction} onClick={() => void loadAssets()} />
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3" onMouseDown={stopCanvasInteraction} onPointerDown={stopCanvasInteraction} onDoubleClick={stopCanvasInteraction} onWheel={stopCanvasInteraction}>
                <textarea
                    value={content}
                    maxLength={30000}
                    placeholder="输入小说、剧本或文案"
                    className="thin-scrollbar min-h-0 w-full flex-1 resize-none rounded-md border bg-transparent p-3 text-[13px] leading-6 outline-none"
                    style={{ borderColor: ctx.theme.node.stroke, color: ctx.theme.node.text, background: ctx.theme.node.fill }}
                    onChange={(event) => {
                        setContent(event.target.value);
                        ctx.updateMetadata({ content: event.target.value });
                    }}
                />
                {sourceContentChanged ? <div className="rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-300">正文已修改，当前资产来自旧版本；重新提取后再生成分镜。</div> : null}
                <div className="flex items-center justify-between text-[11px]" style={{ color: ctx.theme.node.faint }}><span>生成设置</span><span>{content.length.toLocaleString()} / 30,000</span></div>
                <div className="grid grid-cols-2 gap-2">
                    <SettingField label="文本模型" color={ctx.theme.node.faint}>
                        <ModelPicker config={config} value={textModel} capability="text" fullWidth className="!h-9" onMissingConfig={() => openConfigDialog(true)} onChange={(value) => { setTextModel(value); ctx.updateMetadata({ assetExtractionTextModel: value }); }} />
                    </SettingField>
                    <SettingField label="图片模型" color={ctx.theme.node.faint}>
                        <ModelPicker config={config} value={imageModel} capability="image" fullWidth className="!h-9" onMissingConfig={() => openConfigDialog(true)} onChange={(value) => { setImageModel(value); ctx.updateMetadata({ assetExtractionImageModel: value }); }} />
                    </SettingField>
                    <SettingField label="画面风格" color={ctx.theme.node.faint}>
                        <Select className="w-full" value={visualStyle} options={STYLE_OPTIONS} onChange={(value) => { setVisualStyle(value); ctx.updateMetadata({ assetExtractionVisualStyle: value }); }} />
                    </SettingField>
                    <div className="grid grid-cols-2 gap-2">
                        <SettingField label="画幅比例" color={ctx.theme.node.faint}>
                            <Select className="w-full" value={aspectRatio} options={ASPECT_RATIO_OPTIONS} onChange={(value) => { setAspectRatio(value); ctx.updateMetadata({ assetExtractionAspectRatio: value }); }} />
                        </SettingField>
                        <SettingField label="图片质量" color={ctx.theme.node.faint}>
                            <Select className="w-full" value={imageQuality} options={IMAGE_QUALITY_OPTIONS} onChange={(value) => { setImageQuality(value); ctx.updateMetadata({ assetExtractionImageQuality: value }); }} />
                        </SettingField>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button type="primary" className="flex-1" icon={analyzing ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} loading={analyzing} disabled={!scriptSetId || !episodeId} onClick={() => void analyze()}>
                        提取资产
                    </Button>
                    <CanvasQuoteDisplay
                        quote={quote}
                        state={quoteState}
                    label={quoteState === "ready" && quote ? `共 ${assets.length} 张 · ${canvasCompactQuoteLabel(quote)}` : quoteState === "error" ? quoteError || "报价失败" : assets.length ? "报价中..." : "生成图片后报价"}
                        error={quoteError}
                    />
                    <Button icon={generating ? <LoaderCircle className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} loading={generating} disabled={!assets.length || quoteState !== "ready" || !quote?.canSubmit} onClick={() => void generateAll()}>
                        生成全部
                    </Button>
                    <Button
                        icon={<Clapperboard className="size-4" />}
                        className="cursor-not-allowed opacity-45"
                        aria-disabled="true"
                        title="内测中，即将开放"
                        onClick={() => message.info("内测中，即将开放")}
                    >
                        生成分镜节点
                    </Button>
                    {pending.length ? <Button onClick={() => setPendingOpen(true)}>待确认 {pending.length}</Button> : null}
                </div>
            </div>

            <Modal title="确认重复资产" open={pendingOpen} footer={null} width={720} onCancel={() => setPendingOpen(false)}>
                <div className="grid max-h-[60vh] gap-2 overflow-y-auto py-2">
                    {pending.map((item) => (
                        <div key={item.id} className="flex items-center gap-3 rounded-md border p-3">
                            <Tag>{typeLabel(item.assetType)}</Tag>
                            <div className="min-w-0 flex-1">
                                <div className="font-medium">{item.extractedName}</div>
                                <div className="truncate text-xs opacity-60">{item.suggestedAsset ? `可能与“${item.suggestedAsset.name}”重复` : "需要确认是否创建新资产"}</div>
                            </div>
                            {item.suggestedAsset ? <Button size="small" onClick={() => void resolvePending(item, "reuse")}>复用</Button> : null}
                            {item.suggestedAsset ? <Button size="small" onClick={() => void resolvePending(item, "variant")}>作为变体</Button> : null}
                            <Button size="small" type="primary" onClick={() => void resolvePending(item, "new")}>新资产</Button>
                        </div>
                    ))}
                </div>
            </Modal>
        </div>
    );
}

const STYLE_OPTIONS = ["3D漫风格", "仿真人", "2D动漫", "国风水墨", "电影写实", "清新插画"].map((value) => ({ value, label: value }));
const ASPECT_RATIO_OPTIONS = [
    ...["16:9", "9:16", "4:3", "3:4", "1:1"].map((value) => ({ value, label: <span className="inline-flex items-center gap-2"><RectangleHorizontal className="size-4" />{value}</span> })),
];
const IMAGE_QUALITY_OPTIONS = [
    { value: "standard", label: "标准" },
    { value: "medium", label: "中等" },
    { value: "high", label: "高清" },
];

function SettingField({ label, color, children }: { label: string; color: string; children: ReactNode }) {
    return <label className="grid min-w-0 gap-1 text-[11px]" style={{ color }}><span>{label}</span>{children}</label>;
}

function typeLabel(type: ScriptPendingMention["assetType"]) {
    return type === "character" ? "人物" : type === "scene" ? "场景" : "道具";
}

function imageSizeForAspect(aspectRatio: string) {
    return ({ "1:1": "1024x1024", "3:4": "768x1024", "4:3": "1024x768", "9:16": "576x1024", "16:9": "1024x576" } as Record<string, string>)[aspectRatio] || "1024x576";
}

function readError(error: unknown) {
    const value = error as { response?: { data?: { message?: string } }; message?: string };
    return value.response?.data?.message || value.message || "操作失败";
}
