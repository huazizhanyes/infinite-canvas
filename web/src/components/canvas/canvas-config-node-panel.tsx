import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowUp, Image as ImageIcon, MessageSquare, Music2, Settings2, Square, Video } from "lucide-react";
import { Button, Segmented, Tooltip } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, modelMatchesCapability, modelOptionName, resolveModelRequestConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { useUserStore } from "@/stores/use-user-store";
import { canvasBillingApi, canvasCompactQuoteLabel, type CanvasBillingQuote } from "@/services/api/canvas-billing";
import { isCanvasVideoModel } from "@/services/api/canvas-video";
import { CanvasQuoteDisplay } from "./canvas-quote-display";

type CanvasConfigNodePanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    inputSummary: { textCount: number; imageCount: number; videoCount: number; audioCount: number };
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string) => void;
    onStop: (nodeId: string) => void;
    onComposerToggle: () => void;
};

export function CanvasConfigNodePanel({ node, isRunning, inputSummary, onConfigChange, onGenerate, onStop, onComposerToggle }: CanvasConfigNodePanelProps) {
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = node.metadata?.generationMode || "image";
    const config = buildNodeConfig(globalConfig, node, mode);
    const chipStyle = { background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text };
    const hasAnyInput = Boolean(inputSummary.textCount || inputSummary.imageCount || inputSummary.videoCount || inputSummary.audioCount);
    const hasComposerContent = Boolean((node.metadata?.composerContent ?? node.metadata?.prompt ?? "").trim());
    const canGenerate = hasComposerContent || (mode === "audio" ? inputSummary.textCount > 0 : hasAnyInput);
    const connection = useUserStore((state) => state.connection);
    const quotePayload = buildQuotePayload(config, mode, node, inputSummary);
    const quoteKey = JSON.stringify(quotePayload);
    const stableQuotePayload = useMemo(() => quotePayload, [quoteKey]);
    const official = useMemo(() => {
        if (!connection) return false;
        if (mode === "video") return isCanvasVideoModel(config);
        return resolveModelRequestConfig(config, config.model).baseUrl.replace(/\/+$/, "") === connection.canvasBaseUrl.replace(/\/+$/, "");
    }, [config, connection, mode]);
    const [quote, setQuote] = useState<CanvasBillingQuote | null>(null);
    const [quoteState, setQuoteState] = useState<"idle" | "loading" | "ready" | "error">("idle");
    const [quoteError, setQuoteError] = useState("");
    const quoteEligible = mode === "image" || mode === "video" || (mode === "audio" && canGenerate);

    useEffect(() => {
        if (mode === "text" || !official || !connection || !quoteEligible) { setQuote(null); setQuoteState("idle"); setQuoteError(""); return; }
        const controller = new AbortController();
        setQuoteState("loading"); setQuoteError("");
        const timer = window.setTimeout(() => {
            void canvasBillingApi.quote(connection, stableQuotePayload, controller.signal).then((value) => {
                setQuote(value); setQuoteState("ready");
            }).catch((error) => {
                if (controller.signal.aborted) return;
                const payload = error?.response?.data;
                setQuote(null); setQuoteState("error"); setQuoteError(String(payload?.message || error?.message || "报价失败"));
            });
        }, 300);
        return () => { window.clearTimeout(timer); controller.abort(); };
    }, [connection, mode, official, quoteEligible, stableQuotePayload]);

    const quoteBlocked = mode !== "text" && official && quoteEligible && (quoteState !== "ready" || !quote?.canSubmit);
    const quoteLabel = mode === "text" ? "免费" : !official ? "自有渠道" : !quoteEligible ? "输入后计算" : quoteState === "loading" || quoteState === "idle" ? "报价中..." : quoteState === "error" ? (quoteError.includes("MODEL_PRICE") ? "模型暂未开放" : quoteError || "报价失败") : quote ? (quote.canSubmit ? canvasCompactQuoteLabel(quote) : "余额不足") : "等待报价";

    return (
        <div className="flex h-full w-full cursor-move flex-col px-2 pb-2 pt-5 text-[11px]" style={{ color: theme.node.text }} onWheel={(event) => event.stopPropagation()}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="shrink-0 text-[11px] font-semibold">生成配置</div>
                <div className="cursor-default" onMouseDown={(event) => event.stopPropagation()}>
                    <Segmented
                        size="small"
                        className="canvas-config-mode !rounded-md !p-0.5"
                        value={mode}
                        onChange={(value) => onConfigChange(node.id, { generationMode: value as CanvasGenerationMode })}
                        options={[
                            {
                                value: "image",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <ImageIcon className="size-3.5" />
                                        生图
                                    </span>
                                ),
                            },
                            {
                                value: "text",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <MessageSquare className="size-3.5" />
                                        文本
                                    </span>
                                ),
                            },
                            {
                                value: "video",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <Video className="size-3.5" />
                                        视频
                                    </span>
                                ),
                            },
                            {
                                value: "audio",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <Music2 className="size-3.5" />
                                        音频
                                    </span>
                                ),
                            },
                        ]}
                    />
                </div>
            </div>

            <div className="mb-1.5 flex flex-wrap gap-1">
                <InputChip label="提示词" value={`${inputSummary.textCount} 个`} style={chipStyle} />
                <InputChip label="参考图" value={`${inputSummary.imageCount} 张`} style={chipStyle} />
                <InputChip label="参考视频" value={`${inputSummary.videoCount} 个`} style={chipStyle} />
                <InputChip label="参考音频" value={`${inputSummary.audioCount} 个`} style={chipStyle} />
                <button type="button" className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border px-1.5 text-[10px]" style={chipStyle} onMouseDown={(event) => event.stopPropagation()} onClick={onComposerToggle}>
                    <Settings2 className="size-3.5" />
                    组装提示词
                </button>
            </div>

            <div className={`mb-1 grid min-w-0 cursor-default items-center gap-1.5 ${mode === "image" || mode === "video" || mode === "audio" ? "grid-cols-[minmax(0,1fr)_120px]" : "grid-cols-1"}`} onMouseDown={(event) => event.stopPropagation()}>
                <ModelPicker className="canvas-compact-control !h-7 !px-1.5 !text-[11px]" config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability={mode} onMissingConfig={() => openConfigDialog(true)} fullWidth />
                {mode === "video" ? (
                    <CanvasVideoSettingsPopover config={config} hasReferenceVideo={inputSummary.videoCount > 0} placement="topRight" buttonClassName="canvas-compact-control !h-7 !w-full !justify-start !rounded-md !px-1.5 !text-[11px]" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                ) : mode === "image" ? (
                    <CanvasImageSettingsPopover config={config} placement="topRight" autoAdjustOverflow={false} buttonClassName="canvas-compact-control !h-7 !w-full !justify-start !rounded-md !px-1.5 !text-[11px]" onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })} />
                ) : mode === "audio" ? (
                    <CanvasAudioSettingsPopover config={config} placement="topRight" buttonClassName="canvas-compact-control !h-7 !w-full !justify-start !rounded-md !px-1.5 !text-[11px]" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                ) : null}
            </div>

            <div className="mt-auto flex items-center gap-1.5">
                <div className="flex min-w-0 flex-1 justify-end">
                    <CanvasQuoteDisplay quote={quote} state={quoteState} label={quoteLabel} error={quoteError} />
                </div>
                <Tooltip title={isRunning ? "停止生成" : "开始生成"}>
                    <Button type="primary" className="!h-7 !w-7 !min-w-7 !cursor-pointer !rounded-md !p-0" danger={isRunning} disabled={!isRunning && (!canGenerate || quoteBlocked)} onMouseDown={(event) => event.stopPropagation()} onClick={() => (isRunning ? onStop(node.id) : onGenerate(node.id))} aria-label={isRunning ? "停止生成" : "开始生成"} icon={isRunning ? <Square className="size-3 fill-current" /> : <ArrowUp className="size-3.5" />} />
                </Tooltip>
            </div>
        </div>
    );
}

function buildQuotePayload(config: AiConfig, mode: CanvasGenerationMode, node: CanvasNodeData, inputSummary: CanvasConfigNodePanelProps["inputSummary"]) {
    const requestId = `preview-${node.id}`;
    const prompt = String(node.metadata?.composerContent ?? node.metadata?.prompt ?? "").trim();
    if (mode === "text") {
        const request = resolveModelRequestConfig(config, config.model);
        return { feature: "canvas.text.generate", requestId, model: request.model, input: [{ role: "user", content: prompt }] };
    }
    if (mode === "image") {
        const request = resolveModelRequestConfig(config, config.model);
        return { feature: "canvas.image.generate", requestId, model: request.model, prompt: "", count: Number(config.count || 1), size: config.size, quality: config.quality, outputFormat: "png", referenceCount: inputSummary.imageCount };
    }
    if (mode === "audio") {
        const request = resolveModelRequestConfig(config, config.model);
        return { feature: "canvas.audio.speech", requestId, model: request.model, input: prompt, voiceId: Number(config.audioVoice || 0), format: config.audioFormat, speed: Number(config.audioSpeed || 1) };
    }
    return { feature: "canvas.video.generate", requestId, modelId: modelOptionName(config.model), prompt: "", aspectRatio: config.size, quality: config.vquality, duration: Number(config.videoSeconds || 0), mode: config.videoMode, imageAssetIds: Array(inputSummary.imageCount).fill("preview"), videoAssetIds: Array(inputSummary.videoCount).fill("preview"), audioAssetIds: Array(inputSummary.audioCount).fill("preview") };
}

function InputChip({ label, value, style }: { label: string; value: string; style: CSSProperties }) {
    return (
        <div className="inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[10px]" style={style}>
            <span>{label}</span>
            <span className="font-medium">{value}</span>
        </div>
    );
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    const fallbackModel = mode === "image" ? defaultConfig.imageModel : mode === "video" ? defaultConfig.videoModel : mode === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    const currentModel = node.metadata?.model;
    const model = currentModel && modelMatchesCapability(globalConfig, currentModel, mode)
        ? currentModel
        : defaultModel && modelMatchesCapability(globalConfig, defaultModel, mode)
            ? defaultModel
            : fallbackModel;
    return {
        ...globalConfig,
        model,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
