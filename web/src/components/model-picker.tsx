import { useEffect, useId, useMemo, useState } from "react";
import { Bot, Boxes, BrainCircuit, Clapperboard, Code2, Cpu, Image, MessageSquareCode, Mic, Sparkles, WandSparkles } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { modelIconOf, modelOptionLabel, modelOptionName, selectableModelsByCapability, videoCapabilitiesOf, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
    compactVideo?: boolean;
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder = "选择模型", onMissingConfig, compactVideo = false }: ModelPickerProps) {
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const options = useMemo(() => Array.from(new Set([...(config.channelMode === "local" && !capability ? [value] : []), ...selectableModelsByCapability(config, capability)].filter((model): model is string => Boolean(model)))), [capability, config, value]);
    const current = value || "";
    const currentLabel = current ? modelOptionLabel(config, current) : placeholder;

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    return (
        <Select
            open={open}
            value={current}
            onOpenChange={(nextOpen) => {
                if (nextOpen && !options.length && config.channelMode === "local") onMissingConfig?.();
                if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                setOpen(nextOpen);
            }}
            onValueChange={onChange}
        >
            <SelectTrigger
                className={cn(
                    "canvas-composer-model-picker h-8 w-fit max-w-full gap-1.5 rounded-md border border-input bg-transparent px-2 text-xs font-normal shadow-none transition-colors",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    compactVideo
                        ? "!w-[160px] !min-w-0 !max-w-[160px] !flex-none justify-start !shadow-none focus-visible:!border-transparent focus-visible:!outline-none focus-visible:!ring-0 data-[state=open]:!border-transparent data-[state=open]:!shadow-none data-[state=open]:!ring-0 dark:!bg-transparent dark:hover:!bg-transparent"
                        : "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={currentLabel}
            >
                <ModelIcon config={config} model={current} />
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{currentLabel}</span>
            </SelectTrigger>
            <SelectContent
                data-canvas-no-zoom
                hideScrollButtons
                className="z-[1200] w-72 max-w-[calc(100vw-24px)] rounded-lg border border-border/70 bg-popover p-1 text-xs shadow-xl"
                position="popper"
                align="start"
                side="bottom"
                sideOffset={6}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {options.length ? (
                    options.map((model) => (
                        <SelectItem key={model} value={model} textValue={modelOptionLabel(config, model)}>
                            <ModelLabel config={config} model={model} />
                        </SelectItem>
                    ))
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {emptyModelLabel(config, capability)}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability === "image" ? "生图" : capability === "video" ? "视频" : capability === "text" ? "文本" : capability === "audio" ? "音频" : "";
    if (capability && config.models.length) return `请先在渠道里为${label}指定模型`;
    return config.models.length ? `暂无匹配的${label}模型` : "请先到配置里添加渠道和模型";
}

function ModelLabel({ config, model }: { config: AiConfig; model: string }) {
    const video = videoCapabilitiesOf(config, model);
    if (video) {
        const name = `${video.displayBaseName || video.displayName}${video.faceFriendly ? " · 不卡人脸" : ""}`;
        const suffix = video.displaySuffix?.trim();
        return (
            <span className="flex min-w-0 items-center gap-3 py-1" title={video.displayName}>
                <ModelIcon config={config} model={model} large />
                <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium leading-5">{name}</span>
                    {video.freePromotion?.active ? <span className="mt-0.5 block truncate text-[11px] font-medium leading-4 text-emerald-500">{video.freePromotion.label || "限时免费"}</span> : suffix ? <span className="mt-0.5 block truncate text-[11px] leading-4 opacity-55">{suffix}</span> : null}
                </span>
            </span>
        );
    }
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ModelIcon config={config} model={model} />
            <span className="truncate">{modelOptionLabel(config, model)}</span>
        </span>
    );
}

function ModelIcon({ config, model, large = false }: { config: AiConfig; model: string; large?: boolean }) {
    const metadata = modelIconOf(config, model);
    const fallbackUrls = resolveModelIcons(modelOptionName(model));
    const candidates = Array.from(new Set([metadata?.iconUrl, ...fallbackUrls].filter((url): url is string => Boolean(url))));
    const [failedUrls, setFailedUrls] = useState<string[]>([]);
    const url = candidates.find((candidate) => !failedUrls.includes(candidate));

    useEffect(() => setFailedUrls([]), [model, metadata?.iconUrl]);
    const sizeClass = large ? "size-6" : "size-4";
    if (url) return <img src={url} alt="" className={`${sizeClass} shrink-0 object-contain ${fallbackUrls.includes(url) ? "dark:invert" : ""}`} onError={() => setFailedUrls((current) => (current.includes(url) ? current : [...current, url]))} />;
    const Icon = namedModelIcon(metadata?.icon) || capabilityIcon(metadata?.capability);
    return <Icon className={`${sizeClass} shrink-0 opacity-70`} />;
}

function resolveModelIcons(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return publicIcons("claude.svg");
    if (name.includes("gemini") || name.includes("google")) return publicIcons("gemini.svg");
    if (name.includes("gpt") || name.includes("openai")) return publicIcons("openai.svg");
    if (name.includes("grok")) return publicIcons("grok.svg");
    if (name.includes("deepseek")) return publicIcons("deepseek.svg");
    if (name.includes("glm")) return publicIcons("glm.svg");
    return [];
}

function publicIcons(file: string) {
    const baseUrl = import.meta.env.BASE_URL.replace(/\/?$/, "/");
    return Array.from(new Set([`/canvas/icons/${file}`, `${baseUrl}icons/${file}`]));
}

function namedModelIcon(name?: string) {
    const icons = { "message-square-code": MessageSquareCode, "brain-circuit": BrainCircuit, image: Image, clapperboard: Clapperboard, mic: Mic, sparkles: Sparkles, bot: Bot, "code-2": Code2, boxes: Boxes, "wand-sparkles": WandSparkles };
    return name ? icons[name as keyof typeof icons] : undefined;
}

function capabilityIcon(capability?: ModelCapability) {
    if (capability === "image") return Image;
    if (capability === "video") return Clapperboard;
    if (capability === "audio") return Mic;
    if (capability === "text") return MessageSquareCode;
    return Cpu;
}
