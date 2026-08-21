import { useEffect, useMemo, useState } from "react";
import { ArrowUp, LoaderCircle, Square } from "lucide-react";
import { Button, Segmented, Select, Tag, Tooltip } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, modelMatchesCapability, modelOptionName, resolveModelRequestConfig, useConfigStore, useEffectiveConfig, videoCapabilitiesOf, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData, type CanvasTextOperation } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { useUserStore } from "@/stores/use-user-store";
import { canvasBillingApi, canvasCompactQuoteLabel, type CanvasBillingQuote } from "@/services/api/canvas-billing";
import { isCanvasVideoModel } from "@/services/api/canvas-video";
import { CanvasQuoteDisplay } from "./canvas-quote-display";

export type CanvasNodeGenerationMode = CanvasGenerationMode;
export type CanvasNodeGenerationOptions = { operation?: CanvasTextOperation; sourceScope?: "full" | "selection"; skipConfirmation?: boolean };

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options?: CanvasNodeGenerationOptions) => void;
    onStop: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    onImageSettingsOpenChange?: (open: boolean) => void;
    selectedText?: string;
};

const TEXT_ACTIONS: Array<{ value: CanvasTextOperation; label: string; instruction: string }> = [
    { value: "continue", label: "续写", instruction: "续写这段内容，保持原有语气和上下文连贯。" },
    { value: "polish", label: "润色", instruction: "润色这段内容，提升表达清晰度、准确性和可读性，不改变原意。" },
    { value: "expand", label: "扩写", instruction: "扩写这段内容，补充必要细节，但不要添加与原意冲突的信息。" },
    { value: "shorten", label: "缩写", instruction: "压缩这段内容，保留核心信息和关键事实。" },
    { value: "summarize", label: "总结", instruction: "总结这段内容，输出简洁准确的要点。" },
    { value: "translate", label: "翻译", instruction: "将这段内容翻译成自然、准确的中文。" },
    { value: "custom", label: "自定义", instruction: "" },
];

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, onStop, mentionReferences = [], onImageSettingsOpenChange, selectedText = "" }: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = defaultMode(node.type);
    const config = buildNodeConfig(globalConfig, node, mode);
    const videoCapabilities = mode === "video" ? videoCapabilitiesOf(config, config.model) : undefined;
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const [prompt, setPrompt] = useState(isEditingExistingContent ? "" : node.metadata?.prompt || "");
    const [textAction, setTextAction] = useState<CanvasTextOperation>("polish");
    const [textScope, setTextScope] = useState<"full" | "selection">(selectedText.trim() ? "selection" : "full");
    const connection = useUserStore((state) => state.connection);
    const quotePayload = buildQuotePayload(config, mode, node, prompt, mentionReferences);
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
    const quoteEligible = mode === "image" || mode === "video" || (mode === "audio" && Boolean(prompt.trim()));

    useEffect(() => {
        setPrompt(isEditingExistingContent ? "" : node.metadata?.prompt || "");
    }, [isEditingExistingContent, node.id]);

    useEffect(() => {
        if (!selectedText.trim()) setTextScope("full");
        else setTextScope((current) => current === "selection" ? current : "full");
    }, [selectedText]);

    useEffect(() => {
        if (mode === "text" || !official || !connection || !quoteEligible) {
            setQuote(null);
            setQuoteState("idle");
            setQuoteError("");
            return;
        }
        const controller = new AbortController();
        setQuoteState("loading");
        setQuoteError("");
        const timer = window.setTimeout(() => {
            void canvasBillingApi.quote(connection, stableQuotePayload, controller.signal).then((value) => {
                setQuote(value);
                setQuoteState("ready");
            }).catch((error) => {
                if (controller.signal.aborted) return;
                const payload = error?.response?.data;
                setQuote(null);
                setQuoteState("error");
                setQuoteError(String(payload?.message || error?.message || "报价失败"));
            });
        }, 300);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [connection, mode, official, quoteEligible, stableQuotePayload]);

    const quoteBlocked = mode !== "text" && official && quoteEligible && (quoteState !== "ready" || !quote?.canSubmit);
    const quoteLabel = mode === "text"
        ? "免费"
        : !official
          ? "自有渠道"
          : !quoteEligible
            ? "输入后计算"
            : quoteState === "loading" || quoteState === "idle"
              ? "报价中..."
              : quoteState === "error"
                ? quoteError.includes("MODEL_PRICE") ? "模型暂未开放" : quoteError || "报价失败"
                : quote
                  ? quote.canSubmit ? canvasCompactQuoteLabel(quote) : "余额不足"
                  : "等待报价";

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (!isEditingExistingContent) onPromptChange(node.id, value);
    };

    const submit = () => {
        const action = TEXT_ACTIONS.find((item) => item.value === textAction);
        const text = mode === "text" && isEditingExistingContent
            ? [action?.instruction, prompt.trim() ? `补充要求：${prompt.trim()}` : ""].filter(Boolean).join("\n")
            : prompt.trim();
        if (!text || isRunning) return;
        onGenerate(node.id, mode, text, mode === "text" && isEditingExistingContent ? { operation: textAction, sourceScope: textScope } : undefined);
    };

    return (
        <div
            className="rounded-[8px] border p-2 text-[11px] backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: "0 10px 28px rgba(0,0,0,.16)" }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <CanvasResourceMentionTextarea
                value={prompt}
                references={mentionReferences}
                onChange={updatePrompt}
                onSubmit={submit}
                className={`thin-scrollbar w-full resize-none rounded-md border-0 px-3 py-2 text-[12px] leading-5 outline-none ${mode === "video" ? "h-28 min-h-28" : "h-16"}`}
                style={{ background: theme.node.fill, color: theme.node.text }}
                placeholder={mode === "text" && isEditingExistingContent ? textAction === "custom" ? "输入自定义处理要求" : "可选：补充处理要求" : promptPlaceholder(mode, hasImageContent, hasTextContent)}
            />

            {mode === "text" && isEditingExistingContent ? <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Select size="small" value={textAction} onChange={(value) => setTextAction(value as CanvasTextOperation)} options={TEXT_ACTIONS.map((item) => ({ value: item.value, label: item.label }))} />
                <Segmented size="small" value={textScope} onChange={(value) => setTextScope(value as "full" | "selection")} options={[{ value: "full", label: "全文" }, { value: "selection", label: "选中片段", disabled: !selectedText.trim() }]} />
                {selectedText.trim() ? <Tag bordered={false}>已选 {selectedText.length} 字</Tag> : <span className="text-[11px] opacity-60">编辑文字时选中一段即可局部处理</span>}
            </div> : null}

            <div className="mt-1.5 flex min-w-0 items-center gap-1">
                <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                    {mode !== "audio" ? <CanvasPromptLibrary onSelect={updatePrompt} /> : null}
                    {mode === "image" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="image" className="!h-7 !min-w-0 !max-w-[184px] flex-1 !px-1.5 !text-[11px]" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                buttonClassName="!h-7 !max-w-[126px] !justify-start !rounded-md !px-1.5 !text-[11px]"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onImageSettingsOpenChange}
                            />
                        </>
                    ) : mode === "video" ? (
                        <>
                            <Tooltip title="不卡人脸不代表换脸、口型驱动或强身份一致性">
                                <span className="inline-flex h-7 min-w-0 max-w-[184px] flex-1 items-center justify-between gap-2 rounded-md border px-2 text-[11px]" style={{ borderColor: theme.node.stroke }}>
                                    <strong className="truncate">{videoCapabilities?.displayName || "视频模型"}</strong>{videoCapabilities?.faceFriendly ? <span className="shrink-0 text-emerald-500">不卡人脸</span> : null}
                                </span>
                            </Tooltip>
                            <CanvasVideoSettingsPopover config={config} hasReferenceVideo={mentionReferences.some((reference) => reference.active && reference.kind === "video")} buttonClassName="!h-7 !max-w-[126px] !justify-start !rounded-md !px-1.5 !text-[11px]" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                        </>
                    ) : mode === "audio" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="audio" className="!h-7 !w-[168px] !min-w-0 shrink !px-1.5 !text-[11px]" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasAudioSettingsPopover config={config} buttonClassName="!h-7 !w-[122px] !min-w-0 !justify-start !rounded-md !px-1.5 !text-[11px]" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                        </>
                    ) : (
                        <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" className="!h-7 !min-w-0 !max-w-[240px] flex-1 !px-1.5 !text-[11px]" onMissingConfig={() => openConfigDialog(true)} />
                    )}
                </div>
                <CanvasQuoteDisplay quote={quote} state={quoteState} label={quoteLabel} error={quoteError} />
                <Tooltip title={isRunning ? "停止生成" : "开始生成"}>
                    <Button
                        type="primary"
                        className="!h-7 !w-7 !min-w-7 shrink-0 !rounded-md !p-0"
                        danger={isRunning}
                        disabled={!isRunning && (!prompt.trim() || quoteBlocked)}
                        onClick={() => (isRunning ? onStop(node.id) : submit())}
                        aria-label={isRunning ? "停止生成" : "生成"}
                        icon={isRunning ? <Square className="size-3 fill-current" /> : <ArrowUp className="size-3.5" />}
                    />
                </Tooltip>
            </div>
        </div>
    );
}

function buildQuotePayload(config: AiConfig, mode: CanvasNodeGenerationMode, node: CanvasNodeData, prompt: string, references: CanvasResourceReference[]) {
    const requestId = `preview-${node.id}`;
    const activeReferences = references.filter((reference) => reference.active);
    if (mode === "text") {
        const request = resolveModelRequestConfig(config, config.model);
        return { feature: "canvas.text.generate", requestId, model: request.model, input: [{ role: "user", content: prompt.trim() }] };
    }
    if (mode === "image") {
        const request = resolveModelRequestConfig(config, config.model);
        const referenceCount = (node.metadata?.content ? 1 : 0) + activeReferences.filter((reference) => reference.kind === "image").length;
        return { feature: referenceCount ? "canvas.image.edit" : "canvas.image.generate", requestId, model: request.model, prompt: "", count: Number(config.count || 1), size: config.size, quality: config.quality, outputFormat: "png", referenceCount };
    }
    if (mode === "audio") {
        const request = resolveModelRequestConfig(config, config.model);
        return { feature: "canvas.audio.speech", requestId, model: request.model, input: prompt.trim(), voiceId: Number(config.audioVoice || 0), format: config.audioFormat, speed: Number(config.audioSpeed || 1) };
    }
    return {
        feature: "canvas.video.generate",
        requestId,
        modelId: modelOptionName(config.model),
        prompt: "",
        aspectRatio: config.size,
        quality: config.vquality,
        duration: Number(config.videoSeconds || 0),
        mode: config.videoMode,
        imageAssetIds: activeReferences.filter((reference) => reference.kind === "image").map((reference) => reference.id),
        videoAssetIds: activeReferences.filter((reference) => reference.kind === "video").map((reference) => reference.id),
        audioAssetIds: activeReferences.filter((reference) => reference.kind === "audio").map((reference) => reference.id),
        parameters: config.videoParameters || {},
    };
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
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
        videoParameters: node.metadata?.videoParameters && typeof node.metadata.videoParameters === "object" ? node.metadata.videoParameters : globalConfig.videoParameters || defaultConfig.videoParameters,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioVoiceName: node.metadata?.audioVoiceName || globalConfig.audioVoiceName || defaultConfig.audioVoiceName,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
}

function promptPlaceholder(mode: CanvasNodeGenerationMode, hasImageContent: boolean, hasTextContent: boolean) {
    if (mode === "video") return "描述要生成的视频内容";
    if (mode === "audio") return "输入需要配音的文本，或连接上游文本节点";
    if (mode === "image") return hasImageContent ? "请输入你想要把这张图修改成什么" : "描述要生成的图片内容";
    return hasTextContent ? "请输入你想要将本段文本修改成什么" : "请输入你想要生成的文本内容";
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    if (key === "videoParameters") {
        try {
            return { videoParameters: JSON.parse(value) };
        } catch {
            return {};
        }
    }
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioVoiceName") return { audioVoiceName: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
