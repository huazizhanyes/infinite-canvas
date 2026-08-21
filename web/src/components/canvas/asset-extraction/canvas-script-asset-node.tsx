import { useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { App, Button, Tag } from "antd";
import { ImagePlus, LoaderCircle, Save, TriangleAlert, X } from "lucide-react";
import { nanoid } from "nanoid";

import { waitForAssetImages } from "@/components/canvas/asset-extraction/asset-extraction-tasks";
import { generationImageMetadata } from "@/lib/canvas/asset-extraction-layout";
import { canvasBillingApi } from "@/services/api/canvas-billing";
import { canvasScriptApi } from "@/services/api/canvas-script";
import { modelOptionName } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

export function CanvasScriptAssetNode({ ctx }: { ctx: CanvasNodeContext }) {
    const { message } = App.useApp();
    const connection = useUserStore((state) => state.connection);
    const assetId = ctx.node.metadata?.scriptAssetId;
    const scriptSetId = ctx.node.metadata?.scriptSetId;
    const [name, setName] = useState(ctx.node.title);
    const [description, setDescription] = useState(ctx.node.metadata?.scriptAssetVisualDescription || "");
    const [prompt, setPrompt] = useState(ctx.node.metadata?.scriptAssetImagePrompt || "");
    const [saving, setSaving] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const ctxRef = useRef(ctx);
    const resumedBatchRef = useRef<string | undefined>(undefined);
    ctxRef.current = ctx;
    const imageStatus = ctx.node.metadata?.scriptAssetImageStatus || "idle";
    const generating = ["queued", "pending", "running", "generating", "processing"].includes(imageStatus);

    useEffect(() => setName(ctx.node.title), [ctx.node.title]);
    useEffect(() => setDescription(ctx.node.metadata?.scriptAssetVisualDescription || ""), [ctx.node.metadata?.scriptAssetVisualDescription]);
    useEffect(() => setPrompt(ctx.node.metadata?.scriptAssetImagePrompt || ""), [ctx.node.metadata?.scriptAssetImagePrompt]);
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
            if (image) ctxRef.current.updateMetadata(generationImageMetadata(image, batch.id));
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
            const batch = await canvasScriptApi.generateAssets(connection, scriptSetId, [{ assetId }], requestId, selectedModel ? modelOptionName(selectedModel) : undefined, quote.quoteToken);
            resumedBatchRef.current = batch.id;
            const initial = batch.images[0];
            if (initial) ctx.updateMetadata(generationImageMetadata(initial, batch.id));
            const completed = await waitForAssetImages(connection, batch.id, (current) => {
                const image = current.images[0];
                if (image) ctx.updateMetadata(generationImageMetadata(image, current.id));
            });
            const image = completed.images[0];
            if (!image?.imageUrl) throw new Error(image?.error || "图片生成失败");
            message.success("资产图片已生成");
        } catch (error) {
            const reason = readError(error);
            ctx.updateMetadata({ scriptAssetImageStatus: "failed", errorDetails: reason });
            message.error(reason);
        }
    };

    const stopCanvasInteraction = (event: SyntheticEvent) => event.stopPropagation();
    const type = ctx.node.metadata?.scriptAssetType;

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
                    <button type="button" className="h-full w-full cursor-zoom-in" onClick={() => setPreviewOpen(true)} onMouseDown={stopCanvasInteraction} aria-label={`查看${ctx.node.title}大图`}>
                        <img src={ctx.node.metadata.content} alt={ctx.node.title} className="h-full w-full object-contain" />
                    </button>
                ) : generating ? (
                    <div className="flex flex-col items-center gap-2 text-xs" style={{ color: ctx.theme.node.muted }}><LoaderCircle className="size-7 animate-spin" /><span>正在生成图片</span></div>
                ) : imageStatus === "failed" ? (
                    <div className="flex max-w-[80%] flex-col items-center gap-2 text-center text-xs text-red-500"><TriangleAlert className="size-7" /><span>{ctx.node.metadata?.errorDetails || "图片生成失败"}</span></div>
                ) : (
                    <div className="flex flex-col items-center gap-2 text-xs" style={{ color: ctx.theme.node.muted }}><ImagePlus className="size-8 opacity-50" /><span>等待生成图片</span></div>
                )}
                <Button className="absolute bottom-3 right-3" type="primary" size="small" icon={generating ? <LoaderCircle className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />} loading={generating} onMouseDown={stopCanvasInteraction} onClick={() => void generate()}>
                    {ctx.node.metadata?.content ? "重新生成" : imageStatus === "failed" ? "重试" : "生成图片"}
                </Button>
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
                <div className="relative max-h-[94vh] max-w-[96vw]" onClick={(event) => event.stopPropagation()}>
                    <img src={ctx.node.metadata.content} alt={ctx.node.title} className="max-h-[88vh] max-w-[94vw] object-contain" />
                    <button
                        type="button"
                        aria-label="关闭图片预览"
                        title="关闭"
                        className="absolute right-2 top-2 grid size-9 place-items-center rounded-full bg-black/65 text-white transition hover:bg-black/85"
                        onClick={() => setPreviewOpen(false)}
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
