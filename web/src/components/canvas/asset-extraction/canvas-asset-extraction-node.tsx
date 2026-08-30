import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from "react";
import { App, Button, Input, Modal, Popover, Segmented, Select, Tag, Tooltip } from "antd";
import { Boxes, ImagePlus, LayoutGrid, LoaderCircle, Pencil, Plus, RefreshCw, Settings2, Sparkles, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";

import { waitForAssetAnalysis, waitForAssetImages } from "@/components/canvas/asset-extraction/asset-extraction-tasks";
import { ModelPicker } from "@/components/model-picker";
import { CanvasQuoteDisplay } from "@/components/canvas/canvas-quote-display";
import { buildAssetExtractionOps, buildAssetGenerationTargets, generationImageMetadata } from "@/lib/canvas/asset-extraction-layout";
import { assetExtractionContentHash } from "@/lib/canvas/asset-storyboard-draft";
import { ASSET_IMAGE_STATE_CHANGED_EVENT, inspectAssetReadiness } from "@/lib/canvas/asset-storyboard";
import { canvasBillingApi, canvasCompactQuoteLabel, type CanvasBillingQuote } from "@/services/api/canvas-billing";
import { canvasScriptApi, type ScriptAsset, type ScriptEpisode, type ScriptGenerationImage, type ScriptPendingMention } from "@/services/api/canvas-script";
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
    const [episodes, setEpisodes] = useState<ScriptEpisode[]>([]);
    const [episodeBusy, setEpisodeBusy] = useState(false);
    const [renameOpen, setRenameOpen] = useState(false);
    const [renameValue, setRenameValue] = useState("");
    const [assetScope, setAssetScope] = useState<"episode" | "all">("episode");
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
    const currentEpisode = episodes.find((episode) => episode.id === episodeId);
    const episodeAssets = assets.filter((asset) => asset.episodeIds?.includes(episodeId || ""));
    const episodePending = pending.filter((item) => item.episodeId === episodeId);
    const generationTargets = buildAssetGenerationTargets(assets, episodeId, assetScope === "all");
    const currentStatuses = episodeAssets.map((asset) => asset.occurrences?.find((occurrence) => occurrence.episodeId === episodeId)?.matchStatus);
    const episodeStats = {
        added: currentStatuses.filter((status) => status === "new").length,
        reused: currentStatuses.filter((status) => status === "reused").length,
        variants: currentStatuses.filter((status) => status === "variant").length,
    };
    const interactionBusy = analyzing || generating || episodeBusy;
    const generationTargetKey = generationTargets.map((target) => `${target.assetId}:${target.variantId || "base"}`).join(",");
    const quoteKey = `${assetScope}:${generationTargetKey}:${modelOptionName(imageModel)}:${aspectRatio}:${imageQuality}`;

    const activateEpisode = useCallback((episode: ScriptEpisode, nextContent = episode.content || "") => {
        const analyzed = Boolean(episode.analyzedContentHash && episode.analyzedContentHash === assetExtractionContentHash(nextContent));
        setContent(nextContent);
        ctxRef.current.updateMetadata({
            assetExtractionEpisodeId: episode.id,
            content: nextContent,
            assetExtractionContentHash: analyzed ? episode.analyzedContentHash : undefined,
            assetExtractionRunId: undefined,
            assetExtractionStatus: analyzed ? "success" : "idle",
            errorDetails: undefined,
        });
    }, []);

    useEffect(() => {
        setQuote(null);
        setQuoteState("idle");
        setQuoteError("");
        setQuoteRequestId(nanoid());
    }, [quoteKey]);

    useEffect(
        () =>
            ctx.on(ASSET_IMAGE_STATE_CHANGED_EVENT, (payload) => {
                if ((payload as { sourceId?: string } | undefined)?.sourceId === ctx.node.id) setReadinessRevision((value) => value + 1);
            }),
        [ctx],
    );

    useEffect(() => {
        if (!connection || !generationTargets.length) return;
        const controller = new AbortController();
        setQuoteState("loading");
        setQuoteError("");
        void canvasBillingApi
            .quote(
                connection,
                {
                    feature: "canvas.asset.image.generate",
                    requestId: quoteRequestId,
                    model: modelOptionName(imageModel),
                    count: generationTargets.length,
                    size: imageSizeForAspect(aspectRatio),
                    quality: imageQuality,
                    outputFormat: "png",
                },
                controller.signal,
            )
            .then((value) => {
                setQuote(value);
                setQuoteState("ready");
            })
            .catch((error) => {
                if (controller.signal.aborted) return;
                setQuote(null);
                setQuoteState("error");
                setQuoteError(readError(error));
            });
        return () => controller.abort();
    }, [aspectRatio, connection, generationTargetKey, generationTargets.length, imageModel, imageQuality, quoteRequestId]);

    useEffect(() => {
        if (!connection || !scriptSetId) return;
        let canceled = false;
        void canvasScriptApi
            .getSet(connection, scriptSetId)
            .then((set) => {
                if (canceled) return;
                setEpisodes(set.episodes);
                const selected = set.episodes.find((episode) => episode.id === episodeId) || set.episodes[0];
                if (!selected) return;
                if (selected.id !== episodeId || ctxRef.current.node.metadata?.content === undefined) activateEpisode(selected);
            })
            .catch((error) => message.error(`读取剧集失败：${readError(error)}`));
        return () => {
            canceled = true;
        };
    }, [activateEpisode, connection, episodeId, message, scriptSetId]);

    const placeAssets = useCallback((nextAssets: ScriptAsset[], repack = false) => {
        const current = ctxRef.current;
        const source = current.getNode(current.node.id) || current.node;
        const ops = buildAssetExtractionOps(source, nextAssets, current.getNodes(), current.getConnections(), { repack });
        if (ops.length) current.applyOps(ops);
    }, []);

    const loadAssets = useCallback(async () => {
        if (!connection || !scriptSetId) return;
        const data = await canvasScriptApi.listAssets(connection, scriptSetId);
        setAssets(data.assets);
        setPending(data.pending);
        placeAssets(data.assets);
        const currentAssetCount = data.assets.filter((asset) => asset.episodeIds?.includes(episodeId || "")).length;
        const currentPendingCount = data.pending.filter((item) => item.episodeId === episodeId).length;
        ctxRef.current.updateMetadata({ assetExtractionAssetCount: currentAssetCount, assetExtractionPendingCount: currentPendingCount });
        return data;
    }, [connection, episodeId, placeAssets, scriptSetId]);

    useEffect(() => {
        if (!scriptSetId || !connection) return;
        void loadAssets().catch(() => undefined);
    }, [connection, loadAssets, scriptSetId]);

    const saveCurrentEpisode = async () => {
        if (!connection || !episodeId) return;
        const updated = await canvasScriptApi.updateEpisode(connection, episodeId, { content });
        setEpisodes((items) => items.map((item) => (item.id === updated.id ? { ...item, ...updated, analyzedContentHash: item.analyzedContentHash } : item)));
    };

    const switchEpisode = async (nextId: string) => {
        if (!connection || nextId === episodeId || interactionBusy) return;
        const next = episodes.find((episode) => episode.id === nextId);
        if (!next) return;
        setEpisodeBusy(true);
        try {
            await saveCurrentEpisode();
            activateEpisode(next);
        } catch (error) {
            message.error(`切换剧集失败：${readError(error)}`);
        } finally {
            setEpisodeBusy(false);
        }
    };

    const createEpisode = async () => {
        if (!connection || !scriptSetId || interactionBusy) return;
        setEpisodeBusy(true);
        try {
            await saveCurrentEpisode();
            const created = await canvasScriptApi.createEpisode(connection, scriptSetId);
            setEpisodes((items) => [...items, created].sort((left, right) => left.episodeNo - right.episodeNo));
            activateEpisode(created);
            message.success(`已创建${created.title}`);
        } catch (error) {
            message.error(`新建剧集失败：${readError(error)}`);
        } finally {
            setEpisodeBusy(false);
        }
    };

    const renameEpisode = async () => {
        if (!connection || !episodeId || !renameValue.trim()) return;
        setEpisodeBusy(true);
        try {
            const updated = await canvasScriptApi.updateEpisode(connection, episodeId, { title: renameValue.trim(), content });
            setEpisodes((items) => items.map((item) => (item.id === updated.id ? { ...item, ...updated, analyzedContentHash: item.analyzedContentHash } : item)));
            setRenameOpen(false);
            message.success("剧集名称已更新");
        } catch (error) {
            message.error(`重命名失败：${readError(error)}`);
        } finally {
            setEpisodeBusy(false);
        }
    };

    const deleteCurrentEpisode = () => {
        if (!connection || !episodeId || episodes.length <= 1 || interactionBusy) return;
        Modal.confirm({
            title: `删除“${currentEpisode?.title || "当前剧集"}”？`,
            content: "本集正文和资产出现关系将被移除；其他剧集及其仍在使用的全剧资产不受影响。",
            okText: "删除本集",
            okButtonProps: { danger: true },
            cancelText: "取消",
            centered: true,
            onOk: async () => {
                setEpisodeBusy(true);
                try {
                    const currentIndex = episodes.findIndex((episode) => episode.id === episodeId);
                    await canvasScriptApi.deleteEpisode(connection, episodeId);
                    const remaining = episodes.filter((episode) => episode.id !== episodeId);
                    setEpisodes(remaining);
                    activateEpisode(remaining[Math.min(currentIndex, remaining.length - 1)]);
                    await loadAssets();
                    message.success("剧集已删除");
                } catch (error) {
                    message.error(`删除剧集失败：${readError(error)}`);
                } finally {
                    setEpisodeBusy(false);
                }
            },
        });
    };

    useEffect(() => {
        const runId = ctx.node.metadata?.assetExtractionRunId;
        if (!connection || !runId || !analyzing || resumedAnalysisRef.current === runId) return;
        resumedAnalysisRef.current = runId;
        void waitForAssetAnalysis(connection, runId)
            .then(async (run) => {
                if (run.status !== "succeeded") throw new Error(run.error || "资产提取失败");
                const data = await loadAssets();
                const currentAssetCount = data?.assets.filter((asset) => asset.episodeIds?.includes(episodeId || "")).length || 0;
                const currentPendingCount = data?.pending.filter((item) => item.episodeId === episodeId).length || 0;
                ctxRef.current.updateMetadata({ assetExtractionStatus: "success", assetExtractionAssetCount: currentAssetCount, assetExtractionPendingCount: currentPendingCount, assetExtractionUpdatedAt: Date.now() });
            })
            .catch((error) => ctxRef.current.updateMetadata({ assetExtractionStatus: "error", errorDetails: readError(error) }));
    }, [analyzing, connection, ctx.node.metadata?.assetExtractionRunId, episodeId, loadAssets]);

    const runAnalyze = async () => {
        if (!connection || !scriptSetId || !episodeId || analyzing) return;
        if (!content.trim()) {
            message.warning("请先输入小说或文案");
            return;
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
            await Promise.all([canvasScriptApi.updateSet(connection, scriptSetId, { visualStyle, aspectRatio, imageQuality }), canvasScriptApi.updateEpisode(connection, episodeId, { content })]);
            const started = await canvasScriptApi.analyzeEpisode(connection, episodeId, nanoid(), modelOptionName(textModel));
            resumedAnalysisRef.current = started.id;
            ctx.updateMetadata({ assetExtractionRunId: started.id });
            const run = await waitForAssetAnalysis(connection, started.id);
            if (run.status !== "succeeded") throw new Error(run.error || "资产提取失败");
            const data = await loadAssets();
            const currentAssetCount = data?.assets.filter((asset) => asset.episodeIds?.includes(episodeId)).length || 0;
            const currentPendingCount = data?.pending.filter((item) => item.episodeId === episodeId).length || 0;
            ctx.updateMetadata({
                assetExtractionStatus: "success",
                assetExtractionAssetCount: currentAssetCount,
                assetExtractionPendingCount: currentPendingCount,
                assetExtractionUpdatedAt: Date.now(),
            });
            setEpisodes((items) => items.map((item) => (item.id === episodeId ? { ...item, content, contentHash: assetExtractionContentHash(content), analyzedContentHash: assetExtractionContentHash(content), currentAnalysisRunId: started.id } : item)));
            message.success(`本集已识别 ${data?.assets.filter((asset) => asset.episodeIds?.includes(episodeId)).length || 0} 个资产`);
        } catch (error) {
            const reason = readError(error);
            ctx.updateMetadata({ assetExtractionStatus: "error", errorDetails: reason });
            message.error(reason);
        }
    };

    const analyze = () => {
        if (!episodeAssets.length) {
            void runAnalyze();
            return;
        }
        Modal.confirm({
            title: "重新分析本集？",
            content: `系统会重新计算“${currentEpisode?.title || "当前剧集"}”的资产出现与复用关系，不会清空其他剧集的资产，也不会移动已有画布节点。`,
            okText: "重新分析本集",
            cancelText: "取消",
            centered: true,
            onOk: () => runAnalyze(),
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
        if (!connection || !scriptSetId || !generationTargets.length || generating) return;
        setGenerating(true);
        try {
            await canvasScriptApi.updateSet(connection, scriptSetId, { visualStyle, aspectRatio, imageQuality });
            for (let offset = 0; offset < generationTargets.length; offset += 50) {
                const targets = generationTargets.slice(offset, offset + 50);
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
        const readiness = inspectAssetReadiness(source, episodeAssets, current.getNodes(), episodePending.length, assetExtractionContentHash(content));
        if (!readiness.ready) {
            message.warning(readiness.reason);
            return;
        }
        const existing = current.getNodes().find((node) => node.type === CanvasNodeType.AssetStoryboard && node.metadata?.assetStoryboardSourceId === source.id && node.metadata?.assetStoryboardEpisodeId === episodeId);
        if (existing) {
            current.applyOps([{ type: "select_nodes", ids: [existing.id] }]);
            message.info("已存在资产专属分镜节点");
            return;
        }
        const id = nanoid();
        current.applyOps([
            {
                type: "add_node",
                id,
                nodeType: CanvasNodeType.AssetStoryboard,
                title: `${currentEpisode?.title || "本集"} · 资产专属分镜`,
                position: { x: source.position.x, y: source.position.y + source.height + 96 },
                width: 300,
                height: 180,
                metadata: { assetStoryboardSourceId: source.id, assetStoryboardEpisodeId: episodeId, assetStoryboardSourceContent: content, status: "loading" },
            },
            { type: "connect_nodes", id: nanoid(), fromNodeId: source.id, toNodeId: id },
            { type: "select_nodes", ids: [id] },
        ]);
        message.success("已创建资产专属分镜节点");
    };

    const sourceContentChanged = Boolean(content.trim() && ctx.node.metadata?.assetExtractionContentHash && assetExtractionContentHash(content) !== ctx.node.metadata.assetExtractionContentHash);
    const storyboardReadiness = inspectAssetReadiness(ctx.node, episodeAssets, ctx.getNodes(), episodePending.length, assetExtractionContentHash(content));

    const resolvePending = async (item: ScriptPendingMention, decision: "reuse" | "variant" | "new") => {
        if (!connection) return;
        try {
            await canvasScriptApi.resolveMention(connection, item.id, decision, decision === "new" ? undefined : item.suggestedAsset?.id);
            const data = await loadAssets();
            if (!data?.pending.some((pendingItem) => pendingItem.episodeId === episodeId)) setPendingOpen(false);
        } catch (error) {
            message.error(readError(error));
        }
    };

    const stopCanvasInteraction = (event: SyntheticEvent) => event.stopPropagation();
    const statusText = analyzing
        ? "正在分析本集资产..."
        : ctx.node.metadata?.assetExtractionStatus === "error"
          ? ctx.node.metadata.errorDetails || "提取失败"
          : `全剧 ${assets.length} · 本集 ${episodeAssets.length}${episodePending.length ? ` · ${episodePending.length} 项待确认` : ""}`;

    return (
        <div
            className="flex h-full w-full flex-col overflow-hidden"
            style={{ color: ctx.theme.node.text, background: ctx.theme.node.panel, "--ant-color-bg-container": ctx.theme.node.panel, "--ant-color-border": ctx.theme.node.stroke } as CSSProperties}
            data-canvas-no-zoom
        >
            <header className="flex h-14 shrink-0 items-center gap-2.5 border-b px-4" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.toolbar.panel }}>
                <span className="grid size-8 shrink-0 place-items-center rounded-md border" style={{ borderColor: ctx.theme.toolbar.border, background: ctx.theme.toolbar.activeBg, color: ctx.theme.toolbar.activeText }}>
                    <Boxes className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold leading-5">资产提取</div>
                    <div className="truncate text-[10px] leading-4" style={{ color: ctx.node.metadata?.assetExtractionStatus === "error" ? "#ef4444" : ctx.theme.node.muted }}>
                        {statusText}
                    </div>
                </div>
                <Tooltip title="整理资产节点">
                    <Button
                        type="text"
                        className="!grid !size-8 !min-w-8 !place-items-center !p-0"
                        icon={<LayoutGrid className="size-4" />}
                        aria-label="整理资产节点"
                        disabled={!assets.length || interactionBusy}
                        onMouseDown={stopCanvasInteraction}
                        onClick={() => placeAssets(assets, true)}
                    />
                </Tooltip>
                <Tooltip title="刷新资产">
                    <Button type="text" className="!grid !size-8 !min-w-8 !place-items-center !p-0" icon={<RefreshCw className="size-4" />} aria-label="刷新资产" onMouseDown={stopCanvasInteraction} onClick={() => void loadAssets()} />
                </Tooltip>
            </header>

            <div className="flex min-h-0 flex-1 flex-col" onMouseDown={stopCanvasInteraction} onPointerDown={stopCanvasInteraction} onDoubleClick={stopCanvasInteraction} onWheel={stopCanvasInteraction}>
                <section className="shrink-0 border-b px-4 py-3" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.node.fill }}>
                    <div className="flex items-center gap-1.5">
                        <Select
                            className="min-w-0 flex-1"
                            value={episodeId}
                            loading={episodeBusy}
                            disabled={interactionBusy}
                            options={episodes.map((episode) => ({ value: episode.id, label: `${episode.title}${episode.content ? ` · ${episode.content.length.toLocaleString()}字` : ""}` }))}
                            onChange={(value) => void switchEpisode(value)}
                        />
                        <Tooltip title="新建剧集">
                            <Button type="text" className="!grid !size-8 !min-w-8 !place-items-center !p-0" icon={<Plus className="size-4" />} aria-label="新建剧集" disabled={interactionBusy || !scriptSetId} onClick={() => void createEpisode()} />
                        </Tooltip>
                        <Tooltip title="重命名本集">
                            <Button
                                type="text"
                                className="!grid !size-8 !min-w-8 !place-items-center !p-0"
                                icon={<Pencil className="size-3.5" />}
                                aria-label="重命名本集"
                                disabled={interactionBusy || !currentEpisode}
                                onClick={() => {
                                    setRenameValue(currentEpisode?.title || "");
                                    setRenameOpen(true);
                                }}
                            />
                        </Tooltip>
                        <Tooltip title="删除本集">
                            <Button
                                type="text"
                                danger
                                className="!grid !size-8 !min-w-8 !place-items-center !p-0"
                                icon={<Trash2 className="size-3.5" />}
                                aria-label="删除本集"
                                disabled={interactionBusy || episodes.length <= 1}
                                onClick={deleteCurrentEpisode}
                            />
                        </Tooltip>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                        <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden whitespace-nowrap text-[10px]" style={{ color: ctx.theme.node.muted }}>
                            <span>
                                本集 <strong style={{ color: ctx.theme.node.text }}>{episodeAssets.length}</strong>
                            </span>
                            <span>
                                新增 <strong className="text-emerald-400">{episodeStats.added}</strong>
                            </span>
                            <span>
                                复用 <strong className="text-sky-400">{episodeStats.reused}</strong>
                            </span>
                            <span>
                                变体 <strong className="text-amber-400">{episodeStats.variants}</strong>
                            </span>
                            {episodePending.length ? (
                                <button type="button" className="text-red-400 hover:text-red-300" onClick={() => setPendingOpen(true)}>
                                    待确认 {episodePending.length}
                                </button>
                            ) : null}
                        </div>
                        <Segmented
                            className="shrink-0"
                            size="small"
                            value={assetScope}
                            options={[
                                { label: "本集", value: "episode" },
                                { label: "全剧", value: "all" },
                            ]}
                            onChange={(value) => setAssetScope(value as "episode" | "all")}
                        />
                    </div>
                </section>

                <section className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-3">
                    <div className="flex items-center justify-between text-[10px]" style={{ color: ctx.theme.node.muted }}>
                        <span>本集正文</span>
                        <span>{content.length.toLocaleString()} / 30,000</span>
                    </div>
                    <textarea
                        value={content}
                        maxLength={30000}
                        placeholder="输入小说、剧本或文案"
                        className="thin-scrollbar min-h-0 w-full flex-1 resize-none rounded-md border bg-transparent px-3 py-2.5 text-[13px] leading-6 outline-none transition-colors focus:border-sky-500/60"
                        style={{ borderColor: ctx.theme.node.stroke, color: ctx.theme.node.text, background: ctx.theme.node.fill }}
                        onChange={(event) => {
                            setContent(event.target.value);
                            ctx.updateMetadata({ content: event.target.value });
                        }}
                    />
                    {sourceContentChanged ? <div className="rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-300">正文已修改，当前资产来自旧版本；重新提取后再生成分镜。</div> : null}
                </section>

                <section className="shrink-0 border-t px-4 py-2" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.toolbar.panel }}>
                    <div className="flex min-w-0 items-center gap-1.5">
                        <ModelPicker
                            config={config}
                            value={imageModel}
                            capability="image"
                            className="!h-9 !min-w-0 !max-w-[220px] flex-1 !rounded-lg !border-transparent !bg-transparent !px-2 !text-xs hover:!bg-white/5"
                            onMissingConfig={() => openConfigDialog(true)}
                            onChange={(value) => {
                                setImageModel(value);
                                ctx.updateMetadata({ assetExtractionImageModel: value });
                            }}
                        />
                        <Popover
                            trigger="click"
                            placement="topLeft"
                            content={
                                <div className="grid w-72 gap-3" data-canvas-no-zoom>
                                    <SettingField label="文本分析模型" color={ctx.theme.node.faint}>
                                        <ModelPicker
                                            config={config}
                                            value={textModel}
                                            capability="text"
                                            fullWidth
                                            className="!h-8"
                                            onMissingConfig={() => openConfigDialog(true)}
                                            onChange={(value) => {
                                                setTextModel(value);
                                                ctx.updateMetadata({ assetExtractionTextModel: value });
                                            }}
                                        />
                                    </SettingField>
                                    <SettingField label="画面风格" color={ctx.theme.node.faint}>
                                        <Select
                                            className="w-full"
                                            value={visualStyle}
                                            options={STYLE_OPTIONS}
                                            onChange={(value) => {
                                                setVisualStyle(value);
                                                ctx.updateMetadata({ assetExtractionVisualStyle: value });
                                            }}
                                        />
                                    </SettingField>
                                    <div className="grid grid-cols-2 gap-2">
                                        <SettingField label="画幅比例" color={ctx.theme.node.faint}>
                                            <Select
                                                className="w-full"
                                                value={aspectRatio}
                                                options={ASPECT_RATIO_OPTIONS}
                                                onChange={(value) => {
                                                    setAspectRatio(value);
                                                    ctx.updateMetadata({ assetExtractionAspectRatio: value });
                                                }}
                                            />
                                        </SettingField>
                                        <SettingField label="图片质量" color={ctx.theme.node.faint}>
                                            <Select
                                                className="w-full"
                                                value={imageQuality}
                                                options={IMAGE_QUALITY_OPTIONS}
                                                onChange={(value) => {
                                                    setImageQuality(value);
                                                    ctx.updateMetadata({ assetExtractionImageQuality: value });
                                                }}
                                            />
                                        </SettingField>
                                    </div>
                                </div>
                            }
                        >
                            <Button
                                type="text"
                                size="small"
                                className="!h-9 !min-w-0 !max-w-[190px] !justify-start !rounded-lg !px-2.5 !text-xs hover:!bg-white/5"
                                style={{ color: ctx.theme.node.text, background: ctx.theme.node.fill }}
                                icon={<Settings2 className="size-3.5 shrink-0" />}
                            >
                                <span className="truncate">
                                    {visualStyle} · {aspectRatio} · {imageQualityLabel(imageQuality)}
                                </span>
                            </Button>
                        </Popover>
                        <div className="min-w-0 flex-1" />
                        <CanvasQuoteDisplay
                            quote={quote}
                            state={quoteState}
                            label={quoteState === "ready" && quote ? canvasCompactQuoteLabel(quote) : quoteState === "error" ? quoteError || "报价失败" : generationTargets.length ? "报价中..." : "无需生成"}
                            error={quoteError}
                        />
                        <Tooltip title={episodeAssets.length ? "重新分析本集" : "分析本集资产"}>
                            <Button
                                type="text"
                                className="!h-9 !min-w-0 !rounded-lg !px-2.5 !text-xs"
                                icon={analyzing ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                                disabled={!scriptSetId || !episodeId || analyzing}
                                aria-label={episodeAssets.length ? "重新分析本集" : "分析本集资产"}
                                onClick={() => void analyze()}
                            >
                                分析
                            </Button>
                        </Tooltip>
                        <Tooltip title={generationTargets.length ? `生成 ${generationTargets.length} 张资产图` : "资产图片已齐全"}>
                            <Button
                                type="primary"
                                className="!grid !size-9 !min-w-9 !place-items-center !rounded-lg !p-0"
                                icon={generating ? <LoaderCircle className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                                disabled={!generationTargets.length || quoteState !== "ready" || !quote?.canSubmit || generating}
                                aria-label={generationTargets.length ? `生成 ${generationTargets.length} 张资产图` : "资产图片已齐全"}
                                onClick={() => void generateAll()}
                            />
                        </Tooltip>
                    </div>
                </section>
            </div>

            <Modal title="确认重复资产" open={pendingOpen} footer={null} width={720} onCancel={() => setPendingOpen(false)}>
                <div className="grid max-h-[60vh] gap-2 overflow-y-auto py-2">
                    {episodePending.map((item) => (
                        <div key={item.id} className="flex items-center gap-3 rounded-md border p-3">
                            <Tag>{typeLabel(item.assetType)}</Tag>
                            <div className="min-w-0 flex-1">
                                <div className="font-medium">{item.extractedName}</div>
                                <div className="truncate text-xs opacity-60">{item.suggestedAsset ? `可能与“${item.suggestedAsset.name}”重复` : "需要确认是否创建新资产"}</div>
                            </div>
                            {item.suggestedAsset ? (
                                <Button size="small" onClick={() => void resolvePending(item, "reuse")}>
                                    复用
                                </Button>
                            ) : null}
                            {item.suggestedAsset ? (
                                <Button size="small" onClick={() => void resolvePending(item, "variant")}>
                                    作为变体
                                </Button>
                            ) : null}
                            <Button size="small" type="primary" onClick={() => void resolvePending(item, "new")}>
                                新资产
                            </Button>
                        </div>
                    ))}
                </div>
            </Modal>
            <Modal title="重命名剧集" open={renameOpen} okText="保存" cancelText="取消" confirmLoading={episodeBusy} onOk={() => void renameEpisode()} onCancel={() => setRenameOpen(false)}>
                <Input value={renameValue} maxLength={120} autoFocus onChange={(event) => setRenameValue(event.target.value)} onPressEnter={() => void renameEpisode()} />
            </Modal>
        </div>
    );
}

const STYLE_OPTIONS = ["3D漫风格", "仿真人", "2D动漫", "国风水墨", "电影写实", "清新插画"].map((value) => ({ value, label: value }));
const ASPECT_RATIO_OPTIONS = ["16:9", "9:16", "4:3", "3:4", "1:1"].map((value) => ({ value, label: value }));
const IMAGE_QUALITY_OPTIONS = [
    { value: "standard", label: "标准" },
    { value: "medium", label: "中等" },
    { value: "high", label: "高清" },
];

function imageQualityLabel(value: string) {
    return IMAGE_QUALITY_OPTIONS.find((option) => option.value === value)?.label || value;
}

function SettingField({ label, color, children }: { label: string; color: string; children: ReactNode }) {
    return (
        <label className="grid min-w-0 gap-0.5 text-[10px]" style={{ color }}>
            <span>{label}</span>
            {children}
        </label>
    );
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
