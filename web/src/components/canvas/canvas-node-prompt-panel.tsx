import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowUp, AudioLines, Clapperboard, LoaderCircle, Sparkles, Square } from "lucide-react";
import { Button, Dropdown, Segmented, Select, Tag, Tooltip } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, MIN_VIDEO_DURATION_SECONDS, modelMatchesCapability, modelOptionName, normalizeVideoDuration, resolveModelRequestConfig, useConfigStore, useEffectiveConfig, videoCapabilitiesOf, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasResourceMentionTextarea, type CanvasMentionInsertRequest } from "./canvas-resource-mention-textarea";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData, type CanvasTextOperation } from "@/types/canvas";
import { mentionedCanvasResourceReferences, normalizeCanvasResourceMentions, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { useUserStore } from "@/stores/use-user-store";
import { canvasBillingApi, canvasCompactQuoteLabel, type CanvasBillingQuote } from "@/services/api/canvas-billing";
import { isCanvasVideoModel } from "@/services/api/canvas-video";
import { CanvasQuoteDisplay } from "./canvas-quote-display";
import { isNonInterruptibleVideoGeneration, videoModelSelectionPatch } from "@/lib/canvas/canvas-generation-policy";
import { CanvasConnectionPreviewStrip } from "./canvas-connection-preview-strip";
import { appendCanvasConnectionMention, removeCanvasConnectionMention, type CanvasConnectionPreview } from "@/lib/canvas/canvas-connection-previews";
import { canvasPromptCharacterWarning, countCanvasPromptCharacters } from "@/lib/canvas/canvas-prompt-character-count";

export type CanvasNodeGenerationMode = CanvasGenerationMode;
export type CanvasNodeGenerationOptions = { operation?: CanvasTextOperation; sourceScope?: "full" | "selection"; skipConfirmation?: boolean; audioMode?: "synthesis" | "design" };

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options?: CanvasNodeGenerationOptions) => void;
    onStop: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    connectionPreviews?: CanvasConnectionPreview[];
    onRemoveConnection?: (connectionId: string) => void;
    onFocusReferenceNode?: (nodeId: string) => void;
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

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, onStop, mentionReferences = [], connectionPreviews = [], onRemoveConnection, onFocusReferenceNode, onImageSettingsOpenChange, selectedText = "" }: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = defaultMode(node.type);
    const config = buildNodeConfig(globalConfig, node, mode);
    const audioMode = mode === "audio" ? node.metadata?.audioMode || "synthesis" : "synthesis";
    const isVoiceDesign = mode === "audio" && audioMode === "design";
    const videoCapabilities = mode === "video" ? videoCapabilitiesOf(config, config.model) : undefined;
    const videoMode = mode === "video" ? (videoCapabilities?.modes.includes(config.videoMode) ? config.videoMode : videoCapabilities?.modes[0] || config.videoMode) : "";
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const [prompt, setPrompt] = useState(() => savedComposerPrompt(node, isEditingExistingContent));
    const [mentionInsertRequest, setMentionInsertRequest] = useState<CanvasMentionInsertRequest | null>(null);
    const manualVideoModeRef = useRef(false);
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
    const quoteEligible = mode === "image" || mode === "video" || (mode === "audio" && !isVoiceDesign && Boolean(prompt.trim()));
    const activeReferences = activeGenerationReferences(mode, prompt, mentionReferences);
    const promptCharacterCount = mode === "video" ? countCanvasPromptCharacters(prompt) : 0;
    const promptCharacterWarning = mode === "video" ? canvasPromptCharacterWarning(videoCapabilities?.channel, promptCharacterCount) : null;

    useEffect(() => {
        const savedPrompt = savedComposerPrompt(node, isEditingExistingContent);
        const normalizedPrompt = normalizeCanvasResourceMentions(savedPrompt, mentionReferences);
        setPrompt(normalizedPrompt);
        if (normalizedPrompt !== savedPrompt) onPromptChange(node.id, normalizedPrompt);
    }, [isEditingExistingContent, mentionReferences, node.id, node.metadata?.composerContent, node.metadata?.prompt, onPromptChange]);

    useEffect(() => {
        if (!selectedText.trim()) setTextScope("full");
        else setTextScope((current) => current === "selection" ? current : "full");
    }, [selectedText]);

    useEffect(() => {
        if (mode !== "video" || !videoCapabilities?.modes.includes("image2video")) return;
        const hasMedia = hasMentionedMediaReference(prompt, mentionReferences);
        if (!hasMedia) {
            manualVideoModeRef.current = false;
            return;
        }
        if (!manualVideoModeRef.current && config.videoMode !== "image2video") onConfigChange(node.id, { videoMode: "image2video" });
    }, [config.videoMode, mentionReferences, mode, node.id, onConfigChange, prompt, videoCapabilities]);

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
    const quoteLabel = isVoiceDesign ? "免费" : mode === "text"
        ? "免费"
        : !official
          ? "自有渠道"
          : !quoteEligible
            ? "输入后计算"
            : quoteState === "loading" || quoteState === "idle"
               ? ""
              : quoteState === "error"
                ? quoteError.includes("MODEL_PRICE") ? "模型暂未开放" : quoteError || "报价失败"
                : quote
                  ? quote.canSubmit ? canvasCompactQuoteLabel(quote) : "余额不足"
                  : "等待报价";
    const referenceAudio = mode === "audio" ? activeReferences.find((reference) => reference.kind === "audio") : undefined;
    const isMediaComposer = mode === "image" || mode === "video" || mode === "audio";
    const videoGenerationLocked = isNonInterruptibleVideoGeneration(node.type, isRunning);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (mode === "video" && videoCapabilities?.modes.includes("image2video") && !manualVideoModeRef.current && hasMentionedMediaReference(value, mentionReferences) && config.videoMode !== "image2video") {
            onConfigChange(node.id, { videoMode: "image2video" });
        }
        onPromptChange(node.id, value);
    };

    const changeVideoMode = (value: string) => {
        manualVideoModeRef.current = true;
        onConfigChange(node.id, { videoMode: value });
    };

    const insertPreviewMention = (item: CanvasConnectionPreview) => {
        if (appendCanvasConnectionMention(prompt, item.label) === prompt) return;
        const reference = mentionReferences.find((candidate) => candidate.source === "canvas" && candidate.nodeId === item.nodeId && candidate.label === item.label);
        if (!reference) {
            updatePrompt(appendCanvasConnectionMention(prompt, item.label));
            return;
        }
        setMentionInsertRequest((current) => ({ nonce: (current?.nonce || 0) + 1, reference }));
    };

    const submit = () => {
        const action = TEXT_ACTIONS.find((item) => item.value === textAction);
        const text = mode === "text" && isEditingExistingContent
            ? [action?.instruction, prompt.trim() ? `补充要求：${prompt.trim()}` : ""].filter(Boolean).join("\n")
            : prompt.trim();
        if (!text || isRunning) return;
        onGenerate(node.id, mode, text, mode === "text" && isEditingExistingContent ? { operation: textAction, sourceScope: textScope } : mode === "audio" ? { audioMode } : undefined);
    };

    const renderComposerToolbar = (expanded = false) => (
        <div className={`${isMediaComposer ? `canvas-node-media-composer-toolbar ${expanded ? "min-h-10" : "mt-1 min-h-10"}` : "mt-2"} flex min-w-0 items-center gap-1.5 ${mode === "text" ? "max-w-[500px]" : "w-full"}`}>
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                {mode !== "audio" ? <CanvasPromptLibrary onSelect={updatePrompt} /> : null}
                {mode === "image" ? (
                    <>
                        <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="image" className="!h-9 !min-w-0 !max-w-[210px] flex-1 !rounded-lg !border-transparent !bg-transparent !px-2 !text-xs hover:!bg-white/5" onMissingConfig={() => openConfigDialog(true)} />
                        <CanvasImageSettingsPopover
                            config={config}
                            placement="topLeft"
                            buttonClassName="!h-9 !max-w-[170px] !justify-start !rounded-lg !bg-transparent !px-2.5 !text-xs hover:!bg-white/5"
                            onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                            onMissingConfig={() => openConfigDialog(true)}
                            onOpenChange={onImageSettingsOpenChange}
                        />
                    </>
                ) : mode === "video" ? (
                    <>
                        <ModelPicker
                            config={config}
                            value={config.model}
                            onChange={(model) => {
                                const nextCapabilities = videoCapabilitiesOf(config, model);
                                const nextQuality = nextCapabilities?.qualities.length && !nextCapabilities.qualities.some((item) => item.quality === config.vquality)
                                    ? nextCapabilities.qualities[0].quality
                                    : undefined;
                                onConfigChange(node.id, videoModelSelectionPatch(model, nextQuality));
                            }}
                            capability="video"
                            compactVideo
                            className="!h-9 !rounded-lg !border-transparent !bg-transparent !px-2 !text-xs hover:!bg-transparent"
                            onMissingConfig={() => openConfigDialog(true)}
                        />
                        <Dropdown
                            trigger={["click"]}
                            placement="topLeft"
                            menu={{
                                items: (videoCapabilities?.modes || []).map((value) => ({
                                    key: value,
                                    label: videoModeLabel(value),
                                    onClick: () => changeVideoMode(value),
                                })),
                            }}
                        >
                            <Button
                                type="text"
                                size="small"
                                className="!h-9 !min-w-0 !max-w-[170px] !justify-start !rounded-lg !bg-transparent !px-2 !text-xs hover:!bg-white/5"
                                style={{ color: theme.node.text }}
                                icon={<Clapperboard className="size-3.5 shrink-0" />}
                                title="切换生成模式；输入 @ 素材时会自动切换到全能参考"
                                onMouseDown={(event) => event.stopPropagation()}
                                onPointerDown={(event) => event.stopPropagation()}
                            >
                                <span className="truncate">{videoModeLabel(videoMode)}</span>
                                {mentionedMediaReferenceCount(prompt, mentionReferences) > 0 ? <span className="ml-1 shrink-0 opacity-60">{mentionedMediaReferenceCount(prompt, mentionReferences)}项</span> : null}
                            </Button>
                        </Dropdown>
                        <CanvasVideoSettingsPopover config={config} quote={quoteState === "ready" ? quote : null} hasReferenceVideo={activeReferences.some((reference) => reference.kind === "video")} buttonClassName="!h-9 !max-w-[170px] !justify-start !rounded-lg !px-2.5 !text-xs" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                    </>
                ) : mode === "audio" ? (
                    <>
                        <Segmented
                            size="small"
                            className="canvas-media-mode-segmented"
                            style={{
                                "--canvas-mode-bg": theme.node.fill,
                                "--canvas-mode-border": theme.toolbar.border,
                                "--canvas-mode-active-bg": theme.toolbar.activeBg,
                                "--canvas-mode-text": theme.node.muted,
                                "--canvas-mode-active-text": theme.node.text,
                            } as CSSProperties}
                            value={audioMode}
                            options={[
                                { value: "synthesis", label: <span className="inline-flex items-center gap-1.5"><AudioLines className="size-3.5" />音频合成</span> },
                                { value: "design", label: <span className="inline-flex items-center gap-1.5"><Sparkles className="size-3.5" />音色设计</span> },
                            ]}
                            onChange={(value) => onConfigChange(node.id, { audioMode: value as "synthesis" | "design", ...(value === "design" ? { audioFormat: "wav" } : {}) })}
                        />
                        {isVoiceDesign ? (
                            <span className="flex h-9 min-w-0 items-center gap-1 rounded-lg px-2.5 text-[11px] opacity-70" style={{ background: theme.toolbar.activeBg }}>
                                VoxCPM <span className="opacity-60">· 免费</span>
                            </span>
                        ) : (
                            <>
                                <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="audio" className="!h-9 !w-[190px] !min-w-0 shrink !rounded-lg !border-transparent !bg-transparent !px-2 !text-xs hover:!bg-white/5" onMissingConfig={() => openConfigDialog(true)} />
                                <CanvasAudioSettingsPopover config={config} referenceAudioName={official ? referenceAudio?.title || referenceAudio?.label : undefined} buttonClassName="!h-9 !w-[154px] !min-w-0 !justify-start !rounded-lg !bg-transparent !px-2.5 !text-xs hover:!bg-white/5" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                            </>
                        )}
                    </>
                ) : (
                    <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" className="!h-8 !min-w-0 !max-w-[260px] flex-1 !px-2 !text-xs" onMissingConfig={() => openConfigDialog(true)} />
                )}
            </div>
            <CanvasQuoteDisplay quote={quote} state={quoteState} label={quoteLabel} error={quoteError} />
            <Tooltip title={videoGenerationLocked ? "视频任务提交后不可暂停" : isRunning ? "停止生成" : "开始生成"}>
                <Button
                    type="primary"
                    className={`${isMediaComposer ? "!h-8 !w-8 !min-w-8 !rounded-full" : "!h-8 !w-8 !min-w-8 !rounded-md"} shrink-0 !p-0`}
                    danger={isRunning && !videoGenerationLocked}
                    disabled={videoGenerationLocked || (!isRunning && (!prompt.trim() || quoteBlocked))}
                    onClick={() => (isRunning ? onStop(node.id) : submit())}
                    aria-label={videoGenerationLocked ? "视频生成中，不可暂停" : isRunning ? "停止生成" : "生成"}
                    icon={videoGenerationLocked ? <LoaderCircle className="size-3.5 animate-spin" /> : isRunning ? <Square className="size-3 fill-current" /> : <ArrowUp className="size-3.5" />}
                />
            </Tooltip>
        </div>
    );

    return (
        <div
            className={isMediaComposer ? "canvas-node-media-composer overflow-hidden rounded-lg border px-4 pb-3 pt-3 text-xs backdrop-blur" : "rounded-[10px] border p-3 text-xs backdrop-blur"}
            style={{
                background: theme.toolbar.panel,
                borderColor: theme.toolbar.border,
                color: theme.node.text,
                boxShadow: isMediaComposer ? "0 18px 48px rgba(0,0,0,.2)" : "0 10px 28px rgba(0,0,0,.16)",
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <CanvasResourceMentionTextarea
                value={prompt}
                references={mentionReferences}
                onChange={updatePrompt}
                onSubmit={submit}
                richMentions={mode === "image" || mode === "video"}
                mentionInsertRequest={mentionInsertRequest}
                header={isMediaComposer && connectionPreviews.length && onRemoveConnection ? (
                    <CanvasConnectionPreviewStrip
                        items={connectionPreviews}
                        onMention={insertPreviewMention}
                        onRemove={(item) => {
                            updatePrompt(removeCanvasConnectionMention(prompt, item.label));
                            onRemoveConnection(item.connectionId);
                        }}
                        onFocusNode={onFocusReferenceNode}
                    />
                ) : undefined}
                containerClassName={isMediaComposer ? "canvas-node-media-composer-editor" : undefined}
                placeholderClassName={isMediaComposer ? "!inset-x-1 !top-1 text-[15px] leading-6 opacity-70" : "text-[13px] leading-5"}
                className={`thin-scrollbar w-full resize-none border-0 outline-none ${isMediaComposer ? "rounded-none bg-transparent px-1 pb-3 pt-1 text-[15px] leading-6" : "rounded-md px-3.5 py-2.5 text-[13px] leading-5"} ${mode === "video" ? "h-40 min-h-40" : mode === "image" ? "h-36 min-h-36" : mode === "audio" ? "h-28 min-h-28" : "h-20 min-h-20"}`}
                style={{ background: isMediaComposer ? "transparent" : theme.node.fill, color: theme.node.text }}
                placeholder={isVoiceDesign ? "描述想要的音色，例如：年轻、温柔、略带沙哑的女声" : mode === "text" && isEditingExistingContent ? textAction === "custom" ? "输入自定义处理要求" : "可选：补充处理要求" : promptPlaceholder(mode, hasImageContent, hasTextContent)}
                expandedFooter={mode === "video" ? (
                    <>
                        <PromptCharacterCount count={promptCharacterCount} color={theme.node.muted} warning={promptCharacterWarning} />
                        {renderComposerToolbar(true)}
                    </>
                ) : mode === "image" ? renderComposerToolbar(true) : undefined}
            />

            {mode === "video" ? <PromptCharacterCount count={promptCharacterCount} color={theme.node.muted} warning={promptCharacterWarning} /> : null}

            {mode === "text" && isEditingExistingContent ? <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Select size="small" value={textAction} onChange={(value) => setTextAction(value as CanvasTextOperation)} options={TEXT_ACTIONS.map((item) => ({ value: item.value, label: item.label }))} />
                <Segmented size="small" value={textScope} onChange={(value) => setTextScope(value as "full" | "selection")} options={[{ value: "full", label: "全文" }, { value: "selection", label: "选中片段", disabled: !selectedText.trim() }]} />
                {selectedText.trim() ? <Tag bordered={false}>已选 {selectedText.length} 字</Tag> : <span className="text-[11px] opacity-60">编辑文字时选中一段即可局部处理</span>}
            </div> : null}

            {renderComposerToolbar()}
        </div>
    );
}

function PromptCharacterCount({ count, color, warning }: { count: number; color: string; warning: string | null }) {
    return <div className="flex h-4 shrink-0 items-center justify-end whitespace-nowrap px-1 text-[10px] font-medium tabular-nums" style={{ color: warning ? "#f59e0b" : color, opacity: warning ? 0.9 : 0.65 }} aria-label={warning || `提示词字数 ${count}`} aria-live="polite">{warning || `${count} 字`}</div>;
}

function buildQuotePayload(config: AiConfig, mode: CanvasNodeGenerationMode, node: CanvasNodeData, prompt: string, references: CanvasResourceReference[]) {
    const requestId = `preview-${node.id}`;
    const activeReferences = activeGenerationReferences(mode, prompt, references);
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
        const referenceAudio = activeReferences.find((reference) => reference.kind === "audio");
        return { feature: "canvas.audio.speech", requestId, model: request.model, input: prompt.trim(), ...(referenceAudio ? { referenceAudioMediaId: referenceAudio.mediaId || referenceAudio.id } : { voiceId: Number(config.audioVoice || 0) }), format: config.audioFormat, speed: Number(config.audioSpeed || 1) };
    }
    const capabilities = videoCapabilitiesOf(config, config.model);
    const quality = capabilities?.qualities.some((item) => item.quality === config.vquality) ? config.vquality : capabilities?.qualities[0]?.quality || config.vquality;
    const aspectRatio = capabilities?.aspectRatios.includes(config.size) ? config.size : capabilities?.aspectRatios[0] || config.size;
    const modes = capabilities?.modes || [];
    const videoMode = modes.includes(config.videoMode) ? config.videoMode : modes[0] || config.videoMode;
    const durationMax = Number(capabilities?.duration.max);
    const durationOptions = [...(capabilities?.duration.options || [])].filter((value) => value >= MIN_VIDEO_DURATION_SECONDS && (!Number.isFinite(durationMax) || value <= durationMax)).sort((left, right) => left - right);
    const duration = capabilities
        ? normalizeVideoDuration(config.videoSeconds, { ...capabilities.duration, options: durationOptions })
        : Math.max(MIN_VIDEO_DURATION_SECONDS, Number(config.videoSeconds || MIN_VIDEO_DURATION_SECONDS));
    return {
        feature: "canvas.video.generate",
        requestId,
        modelId: modelOptionName(config.model),
        prompt: "",
        aspectRatio,
        quality,
        duration,
        mode: videoMode,
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
        videoMode: node.metadata?.videoMode || globalConfig.videoMode || defaultConfig.videoMode,
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
    if (mode === "video") return "描述你想要生成的画面内容，@ 引用素材";
    if (mode === "audio") return "输入需要配音的文本，或连接上游文本节点";
    if (mode === "image") return hasImageContent ? "描述你想要如何修改这张图片，@ 引用主体" : "描述你想要生成的图片，@ 引用主体";
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

function mentionedMediaReferenceCount(prompt: string, references: CanvasResourceReference[]) {
    return references.filter((reference) => reference.active && reference.kind !== "text" && prompt.includes(reference.label)).length;
}

function activeGenerationReferences(mode: CanvasNodeGenerationMode, prompt: string, references: CanvasResourceReference[]) {
    const normalizedPrompt = normalizeCanvasResourceMentions(prompt, references);
    const mentionedCanvasIds = new Set(mentionedCanvasResourceReferences(normalizedPrompt, references).map((reference) => reference.nodeId));
    return references.filter((reference) => {
        if (!reference.active) return false;
        if (reference.source === "user-asset") return prompt.includes(`@${reference.label}`) || prompt.includes(reference.label);
        if (mode === "video" && (reference.kind === "image" || reference.kind === "video")) return mentionedCanvasIds.has(reference.nodeId);
        return true;
    });
}

function savedComposerPrompt(node: CanvasNodeData, isEditingExistingContent: boolean) {
    const composerContent = node.metadata?.composerContent;
    // Older disconnects could leave an empty composer over a valid video prompt.
    if (node.type === CanvasNodeType.Video && composerContent === "" && node.metadata?.prompt) return node.metadata.prompt;
    return composerContent ?? (isEditingExistingContent ? "" : node.metadata?.prompt || "");
}

function hasMentionedMediaReference(prompt: string, references: CanvasResourceReference[]) {
    return mentionedMediaReferenceCount(prompt, references) > 0;
}

function videoModeLabel(mode: string) {
    if (mode === "text2video") return "文生视频";
    if (mode === "image2video") return "全能参考";
    if (mode === "frames2video") return "首尾帧";
    if (mode === "first-frame-to-video") return "首帧生视频";
    return mode || "视频模式";
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioVoiceName") return { audioVoiceName: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
