import { useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { App, Button, Tag } from "antd";
import { Download, FolderPlus, ImagePlus, LoaderCircle, RotateCcw, Save, TriangleAlert, Upload, X, ZoomIn, ZoomOut } from "lucide-react";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";

import { waitForAssetImages } from "@/components/canvas/asset-extraction/asset-extraction-tasks";
import { generationImageMetadata } from "@/lib/canvas/asset-extraction-layout";
import { ASSET_IMAGE_STATE_CHANGED_EVENT } from "@/lib/canvas/asset-storyboard";
import { canvasBillingApi } from "@/services/api/canvas-billing";
import { canvasScriptApi } from "@/services/api/canvas-script";
import { uploadImage } from "@/services/image-storage";
import { getDataUrlByteSize } from "@/lib/image-utils";
import { useAssetStore, type ImageAsset } from "@/stores/use-asset-store";
import { modelOptionName } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

export function CanvasScriptAssetNode({ ctx }: { ctx: CanvasNodeContext }) {
    const { message } = App.useApp();
    const connection = useUserStore((state) => state.connection);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const assetId = ctx.node.metadata?.scriptAssetId;
    const scriptSetId = ctx.node.metadata?.scriptSetId;
    const [name, setName] = useState(ctx.node.title);
    const [description, setDescription] = useState(ctx.node.metadata?.scriptAssetVisualDescription || "");
    const [prompt, setPrompt] = useState(ctx.node.metadata?.scriptAssetImagePrompt || "");
    const [saving, setSaving] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewScale, setPreviewScale] = useState(1);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const ctxRef = useRef(ctx);
    const resumedBatchRef = useRef<string | undefined>(undefined);
    const archivingRef = useRef<string | null>(null);
    // 失败的同一内容只尝试一次，避免本地 blob URL 被不断替换而触发上传 effect。
    const failedContentRef = useRef<string | null>(null);
    ctxRef.current = ctx;
    const imageStatus = ctx.node.metadata?.scriptAssetImageStatus || "idle";
    const generating = ["queued", "pending", "running", "generating", "processing"].includes(imageStatus);

    useEffect(() => setName(ctx.node.title), [ctx.node.title]);
    useEffect(() => setDescription(ctx.node.metadata?.scriptAssetVisualDescription || ""), [ctx.node.metadata?.scriptAssetVisualDescription]);
    useEffect(() => setPrompt(ctx.node.metadata?.scriptAssetImagePrompt || ""), [ctx.node.metadata?.scriptAssetImagePrompt]);
    useEffect(() => {
        const sourceId = ctx.node.metadata?.assetExtractionNodeId;
        if (sourceId) ctx.emit(ASSET_IMAGE_STATE_CHANGED_EVENT, { sourceId, assetNodeId: ctx.node.id });
    }, [ctx, ctx.node.id, ctx.node.metadata?.assetExtractionNodeId, ctx.node.metadata?.content, ctx.node.metadata?.mediaStatus, imageStatus]);
    useEffect(() => {
        const metadata = ctx.node.metadata;
        const content = metadata?.content;
        if (!content || metadata?.mediaId || archivingRef.current === content || failedContentRef.current === content) return;
        archivingRef.current = content;
        void uploadImage(content)
            .then((uploaded) => {
                const mediaStatus = uploaded.mediaStatus || (uploaded.mediaId ? "synced" : "failed");
                if (mediaStatus === "failed") failedContentRef.current = uploaded.url;
                else failedContentRef.current = null;
                ctxRef.current.updateMetadata({
                    content: uploaded.url,
                    storageKey: uploaded.storageKey,
                    mediaId: uploaded.mediaId,
                    mediaStatus,
                    naturalWidth: uploaded.width,
                    naturalHeight: uploaded.height,
                    bytes: uploaded.bytes,
                    mimeType: uploaded.mimeType,
                });
                archivingRef.current = null;
            })
            .catch((error) => {
                // 保留当前内容和本地 storageKey；失败状态由 failedContentRef 阻止自动重试。
                failedContentRef.current = content;
                archivingRef.current = null;
                ctxRef.current.updateMetadata({ mediaStatus: "failed", errorDetails: readError(error) });
            });
    }, [ctx.node.metadata?.content, ctx.node.metadata?.mediaId]);
    useEffect(() => {
        if (!previewOpen) return;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setPreviewOpen(false);
        };
        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape);
    }, [previewOpen]);
    useEffect(() => {
        const batchId = ctx.node.metadata?.scriptAssetImageBatchId;
        if (!connection || !batchId || !generating || resumedBatchRef.current === batchId) return;
        resumedBatchRef.current = batchId;
        void waitForAssetImages(connection, batchId, (batch) => {
            const image = batch.images.find((item) => item.assetId === assetId);
            if (!image) return;
            const next = generationImageMetadata(image, batch.id);
            ctxRef.current.updateMetadata(next);
        }).catch((error) => ctxRef.current.updateMetadata({ scriptAssetImageStatus: "failed", errorDetails: readError(error) }));
    }, [assetId, connection, ctx.node.metadata?.scriptAssetImageBatchId, generating]);

    const save = async () => {
        if (!connection || !assetId) return false;
        setSaving(true);
        try {
            const asset = await canvasScriptApi.updateAsset(connection, assetId, { name, visualDescription: description, imagePrompt: prompt });
            ctx.updateNode({ title: asset.name });
            ctx.updateMetadata({ scriptAssetVisualDescription: asset.visualDescription, scriptAssetImagePrompt: asset.imagePrompt });
            message.success("资产描述已保存");
            return true;
        } catch (error) {
            message.error(readError(error));
            return false;
        } finally {
            setSaving(false);
        }
    };

    const generate = async () => {
        if (!connection || !assetId || !scriptSetId || generating) return;
        ctx.updateMetadata({ scriptAssetImageBatchId: undefined, scriptAssetImageStatus: "queued", errorDetails: undefined });
        try {
            if (name !== ctx.node.title || description !== ctx.node.metadata?.scriptAssetVisualDescription || prompt !== ctx.node.metadata?.scriptAssetImagePrompt) {
                const saved = await save();
                if (!saved) {
                    ctx.updateMetadata({ scriptAssetImageStatus: imageStatus });
                    return;
                }
            }
            const source = ctx.getNode(ctx.node.metadata?.assetExtractionNodeId || "");
            const sourceMeta = source?.metadata;
            await canvasScriptApi.updateSet(connection, scriptSetId, {
                visualStyle: sourceMeta?.assetExtractionVisualStyle,
                aspectRatio: sourceMeta?.assetExtractionAspectRatio,
                imageQuality: sourceMeta?.assetExtractionImageQuality,
            });
            const selectedModel = sourceMeta?.assetExtractionImageModel || ctx.node.metadata?.assetExtractionImageModel;
            const requestId = nanoid();
            const quote = await canvasBillingApi.quote(connection, {
                feature: "canvas.asset.image.generate",
                requestId,
                model: selectedModel ? modelOptionName(selectedModel) : undefined,
                count: 1,
                size: imageSizeForAspect(sourceMeta?.assetExtractionAspectRatio || "16:9"),
                quality: sourceMeta?.assetExtractionImageQuality || "standard",
                outputFormat: "png",
            });
            if (!quote.canSubmit) throw new Error("图片余额不足，请先充值或调整账户权益");
            ctx.updateMetadata({ content: undefined, storageKey: undefined, mediaId: undefined, mediaStatus: undefined, naturalWidth: undefined, naturalHeight: undefined, bytes: undefined, mimeType: undefined });
            const batch = await canvasScriptApi.generateAssets(connection, scriptSetId, [{ assetId }], requestId, selectedModel ? modelOptionName(selectedModel) : undefined, quote.quoteToken);
            resumedBatchRef.current = batch.id;
            const initial = batch.images[0];
            if (initial) ctx.updateMetadata(generationImageMetadata(initial, batch.id));
            const completed = await waitForAssetImages(connection, batch.id, (current) => {
                const image = current.images[0];
                if (!image) return;
                const next = generationImageMetadata(image, current.id);
                ctx.updateMetadata(next);
            });
            const image = completed.images[0];
            if (!image?.imageUrl) throw new Error(image?.error || "图片生成失败");
            await archiveGeneratedImage(image.imageUrl, generationImageMetadata(image, completed.id));
            message.success("资产图片已生成");
        } catch (error) {
            const reason = readError(error);
            ctx.updateMetadata({ scriptAssetImageStatus: "failed", errorDetails: reason });
            message.error(reason);
        }
    };

    const uploadAssetImage = async (file: File) => {
        if (!file.type.startsWith("image/")) {
            message.warning("请选择图片文件");
            return;
        }
        try {
            const uploaded = await uploadImage(file);
            failedContentRef.current = null;
            ctx.updateMetadata({
                content: uploaded.url,
                storageKey: uploaded.storageKey,
                mediaId: uploaded.mediaId,
                mediaStatus: uploaded.mediaStatus || (uploaded.mediaId ? "synced" : "failed"),
                naturalWidth: uploaded.width,
                naturalHeight: uploaded.height,
                bytes: uploaded.bytes,
                mimeType: uploaded.mimeType,
                scriptAssetImageStatus: "success",
                errorDetails: undefined,
            });
            message.success("资产图片已上传");
        } catch (error) {
            ctx.updateMetadata({ mediaStatus: "failed", errorDetails: readError(error) });
            message.error(readError(error));
        }
    };

    const archiveGeneratedImage = async (imageUrl: string, metadata: ReturnType<typeof generationImageMetadata>) => {
        if (!imageUrl || ctxRef.current.node.metadata?.mediaId || archivingRef.current === imageUrl || failedContentRef.current === imageUrl) return;
        archivingRef.current = imageUrl;
        try {
            const uploaded = await uploadImage(imageUrl);
            const mediaStatus = uploaded.mediaStatus || (uploaded.mediaId ? "synced" : "failed");
            if (mediaStatus === "failed") failedContentRef.current = uploaded.url;
            else failedContentRef.current = null;
            ctxRef.current.updateMetadata({
                ...metadata,
                content: uploaded.url,
                storageKey: uploaded.storageKey,
                mediaId: uploaded.mediaId,
                mediaStatus,
                naturalWidth: uploaded.width,
                naturalHeight: uploaded.height,
                bytes: uploaded.bytes,
                mimeType: uploaded.mimeType,
            });
        } catch (error) {
            failedContentRef.current = imageUrl;
            ctxRef.current.updateMetadata({ ...metadata, mediaStatus: "failed", errorDetails: readError(error) });
            throw error;
        } finally {
            archivingRef.current = null;
        }
    };

    const stopCanvasInteraction = (event: SyntheticEvent) => event.stopPropagation();
    const type = ctx.node.metadata?.scriptAssetType;

    const downloadImage = () => {
        const content = ctx.node.metadata?.content;
        if (!content) return;
        saveAs(content, `${safeFilename(name || ctx.node.title || "资产图片")}.png`);
    };

    const saveToMyAssets = () => {
        const metadata = ctx.node.metadata;
        if (!metadata?.content || !assetId) return;
        const dataUrl = metadata.storageKey ? "" : metadata.content;
        const next: Omit<ImageAsset, "id" | "createdAt" | "updatedAt"> = {
            kind: "image",
            title: name || ctx.node.title || "资产图片",
            coverUrl: metadata.content,
            tags: [type === "character" ? "人物" : type === "scene" ? "场景" : "道具"],
            source: "资产提取",
            data: {
                dataUrl,
                storageKey: metadata.storageKey,
                mediaId: metadata.mediaId,
                mediaStatus: metadata.mediaStatus,
                width: metadata.naturalWidth || ctx.node.width,
                height: metadata.naturalHeight || ctx.node.height,
                bytes: metadata.bytes || getDataUrlByteSize(dataUrl),
                mimeType: metadata.mimeType || "image/png",
            },
            metadata: { source: "script-asset", scriptAssetId: assetId, nodeId: ctx.node.id, description, prompt },
        };
        const existing = assets.find((asset) => asset.kind === "image" && asset.metadata?.scriptAssetId === assetId);
        if (existing) {
            updateAsset(existing.id, next);
            message.success("我的资产已更新");
        } else {
            addAsset(next);
            message.success("已加入我的资产");
        }
    };

    const createImageNode = () => {
        const metadata = ctx.node.metadata;
        if (!metadata?.content) return;
        const ratio = (metadata.naturalWidth || 16) / (metadata.naturalHeight || 9);
        const width = 340;
        const height = Math.min(420, Math.max(160, width / ratio));
        const id = nanoid();
        ctx.applyOps([
            {
                type: "add_node",
                id,
                nodeType: CanvasNodeType.Image,
                title: name || ctx.node.title,
                position: { x: ctx.node.position.x + ctx.node.width + 96, y: ctx.node.position.y + ctx.node.height / 2 - height / 2 },
                width,
                height,
                metadata: {
                    content: metadata.content,
                    storageKey: metadata.storageKey,
                    mediaId: metadata.mediaId,
                    mediaStatus: metadata.mediaStatus,
                    naturalWidth: metadata.naturalWidth,
                    naturalHeight: metadata.naturalHeight,
                    bytes: metadata.bytes,
                    mimeType: metadata.mimeType,
                    prompt,
                    status: "success",
                    sourceScriptAssetId: assetId,
                },
            },
            { type: "connect_nodes", fromNodeId: ctx.node.id, toNodeId: id },
            { type: "select_nodes", ids: [id] },
        ]);
        message.success("已创建图片节点");
    };

    return (
        <>
        <div
            className="grid h-full w-full grid-cols-[46%_54%] overflow-hidden"
            style={{ color: ctx.theme.node.text, background: ctx.theme.node.panel, "--ant-color-bg-container": ctx.theme.node.panel, "--ant-color-border": ctx.theme.node.stroke } as CSSProperties}
            data-canvas-no-zoom
        >
            <section className="flex min-h-0 flex-col gap-2 border-r p-3" style={{ borderColor: ctx.theme.node.stroke }} onMouseDown={stopCanvasInteraction} onPointerDown={stopCanvasInteraction} onDoubleClick={stopCanvasInteraction} onWheel={stopCanvasInteraction}>
                <div className="flex items-center gap-2">
                    <Tag color={type === "character" ? "blue" : type === "scene" ? "green" : "gold"}>{type === "character" ? "人物" : type === "scene" ? "场景" : "道具"}</Tag>
                    {ctx.node.metadata?.scriptAssetStale ? <Tag>本次未识别</Tag> : null}
                </div>
                <input value={name} className="h-8 rounded-md border bg-transparent px-2 text-sm font-semibold outline-none" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.node.fill }} onChange={(event) => setName(event.target.value)} />
                <textarea value={description} placeholder="视觉描述" className="thin-scrollbar min-h-0 w-full flex-1 resize-none rounded-md border bg-transparent p-2 text-xs leading-5 outline-none" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.node.fill }} onChange={(event) => setDescription(event.target.value)} />
                <textarea value={prompt} placeholder="生图提示词" className="thin-scrollbar h-20 w-full shrink-0 resize-none rounded-md border bg-transparent p-2 text-xs leading-5 outline-none" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.node.fill }} onChange={(event) => setPrompt(event.target.value)} />
                <Button size="small" icon={<Save className="size-3.5" />} loading={saving} onClick={() => void save()}>保存描述</Button>
            </section>

            <section className="relative grid min-h-0 place-items-center overflow-hidden" style={{ background: ctx.theme.node.fill }}>
                {ctx.node.metadata?.content ? (
                    <button type="button" className="h-full w-full cursor-default" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => { event.stopPropagation(); setPreviewOpen(true); }} onMouseDown={stopCanvasInteraction} aria-label={`双击查看${ctx.node.title}大图`}>
                        <img src={ctx.node.metadata.content} alt={ctx.node.title} className="h-full w-full object-contain" />
                    </button>
                ) : generating ? (
                    <div className="flex flex-col items-center gap-2 text-xs" style={{ color: ctx.theme.node.muted }}><LoaderCircle className="size-7 animate-spin" /><span>正在生成图片</span></div>
                ) : imageStatus === "failed" ? (
                    <div className="flex max-w-[80%] flex-col items-center gap-2 text-center text-xs text-red-500"><TriangleAlert className="size-7" /><span>{ctx.node.metadata?.errorDetails || "图片生成失败"}</span></div>
                ) : (
                    <div className="flex flex-col items-center gap-3 text-xs" style={{ color: ctx.theme.node.muted }}>
                        <ImagePlus className="size-8 opacity-50" />
                        <span>还没有资产图片</span>
                        <div className="flex items-center gap-2">
                            <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>上传图片</Button>
                            <Button type="primary" size="small" icon={<ImagePlus className="size-3.5" />} onClick={() => void generate()}>生成资产图</Button>
                        </div>
                    </div>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadAssetImage(file); }} />
                <div className="absolute bottom-3 right-3 flex items-center gap-1.5" onMouseDown={stopCanvasInteraction}>
                    {ctx.node.metadata?.content ? <>
                        <Button size="small" icon={<Upload className="size-3.5" />} title="替换图片" aria-label="替换图片" onClick={() => fileInputRef.current?.click()} />
                        <Button size="small" icon={<Download className="size-3.5" />} title="下载图片" aria-label="下载图片" onClick={downloadImage} />
                        <Button size="small" icon={<FolderPlus className="size-3.5" />} title="保存到我的资产" aria-label="保存到我的资产" onClick={saveToMyAssets} />
                        <Button size="small" icon={<ImagePlus className="size-3.5" />} title="创建图片节点" aria-label="创建图片节点" onClick={createImageNode} />
                    </> : null}
                    {ctx.node.metadata?.content || imageStatus === "failed" ? <Button type="primary" size="small" icon={generating ? <LoaderCircle className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />} loading={generating} onClick={() => void generate()}>
                        {ctx.node.metadata?.content ? "重新生成" : "重试"}
                    </Button> : null}
                </div>
            </section>
        </div>
        {previewOpen && ctx.node.metadata?.content ? createPortal(
            <div
                className="fixed inset-0 z-[2000] grid place-items-center bg-black/75 p-6"
                data-canvas-no-zoom
                onClick={(event) => {
                    if (event.target === event.currentTarget) setPreviewOpen(false);
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <div className="relative flex h-[90vh] w-[94vw] items-center justify-center overflow-hidden" onClick={(event) => event.stopPropagation()} onWheel={(event) => { event.preventDefault(); setPreviewScale((value) => clampScale(value + (event.deltaY < 0 ? 0.15 : -0.15))); }}>
                    <img src={ctx.node.metadata.content} alt={ctx.node.title} className="max-h-[82vh] max-w-[90vw] object-contain transition-transform" style={{ transform: `scale(${previewScale})` }} />
                    <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md bg-black/65 p-1 text-white">
                        <button type="button" className="grid size-8 place-items-center rounded hover:bg-white/15" title="缩小" aria-label="缩小" onClick={() => setPreviewScale((value) => clampScale(value - 0.2))}><ZoomOut className="size-4" /></button>
                        <span className="w-12 text-center text-xs">{Math.round(previewScale * 100)}%</span>
                        <button type="button" className="grid size-8 place-items-center rounded hover:bg-white/15" title="放大" aria-label="放大" onClick={() => setPreviewScale((value) => clampScale(value + 0.2))}><ZoomIn className="size-4" /></button>
                        <button type="button" className="grid size-8 place-items-center rounded hover:bg-white/15" title="恢复原始大小" aria-label="恢复原始大小" onClick={() => setPreviewScale(1)}><RotateCcw className="size-4" /></button>
                        <button type="button" className="grid size-8 place-items-center rounded hover:bg-white/15" title="下载图片" aria-label="下载图片" onClick={downloadImage}><Download className="size-4" /></button>
                    </div>
                    <button
                        type="button"
                        aria-label="关闭图片预览"
                        title="关闭"
                        className="absolute right-2 top-2 grid size-9 place-items-center rounded-full bg-black/65 text-white transition hover:bg-black/85"
                        onClick={() => { setPreviewOpen(false); setPreviewScale(1); }}
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <X className="size-5" />
                    </button>
                </div>
            </div>,
            document.body,
        ) : null}
        </>
    );
}

function imageSizeForAspect(aspectRatio: string) {
    return ({ "1:1": "1024x1024", "3:4": "768x1024", "4:3": "1024x768", "9:16": "576x1024", "16:9": "1024x576" } as Record<string, string>)[aspectRatio] || "1024x576";
}

function readError(error: unknown) {
    const value = error as { response?: { data?: { message?: string } }; message?: string };
    return value.response?.data?.message || value.message || "操作失败";
}

function clampScale(value: number) {
    return Math.min(4, Math.max(0.25, Number(value.toFixed(2))));
}

function safeFilename(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_").trim() || "资产图片";
}
