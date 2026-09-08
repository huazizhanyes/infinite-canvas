import { useEffect, useId, useMemo, useState } from "react";
import { Tooltip } from "antd";
import { BadgeCheck, Bot, Boxes, BrainCircuit, CircleHelp, Clock3, Clapperboard, Code2, Cpu, Image, MessageSquareCode, Mic, Sparkles, WandSparkles } from "lucide-react";

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
                className="z-[1200] !max-h-[min(var(--radix-select-content-available-height),29rem)] w-72 max-w-[calc(100vw-24px)] !overflow-hidden rounded-lg border border-border/70 bg-popover p-0.5 text-xs shadow-xl"
                viewportClassName="!h-auto !max-h-[min(var(--radix-select-content-available-height),29rem)] overscroll-contain"
                position="popper"
                align="start"
                side="bottom"
                sideOffset={6}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {options.length ? (
                    options.map((model) => (
                        <SelectItem
                            key={model}
                            value={model}
                            textValue={modelOptionLabel(config, model)}
                            className="my-1 w-full rounded-none border-0 border-b border-white/12 py-1.5 first:mt-0 last:mb-0 data-[state=checked]:border-b-sky-300/35 data-[state=checked]:bg-sky-400/12 data-[state=checked]:shadow-[inset_3px_0_0_rgba(56,189,248,.95)] [&>span:last-child]:min-w-0 [&>span:last-child]:w-full"
                        >
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
            <span className="grid w-full min-w-0 grid-cols-[32px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0" aria-label={video.displayName}>
                <ModelIcon config={config} model={model} large />
                <span className="relative min-w-0 flex-1">
                    <span className="block truncate pr-20 text-[13px] font-medium leading-4">{name}</span>
                    {video.freePromotion?.active ? <span className="mt-0.5 block truncate text-[10px] font-medium leading-3.5 text-emerald-500">{video.freePromotion.label || "限时免费"}</span> : suffix ? <span className="mt-0.5 block truncate text-[10px] leading-3.5 opacity-55">{suffix}</span> : null}
                    <VideoBillingBadge video={video} />
                </span>
                <ModelHealthSummary video={video} />
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
    const sizeClass = large ? "size-7" : "size-4";
    if (url) return <img src={url} alt="" className={`${sizeClass} shrink-0 object-contain ${fallbackUrls.includes(url) ? "dark:invert" : ""}`} onError={() => setFailedUrls((current) => (current.includes(url) ? current : [...current, url]))} />;
    const Icon = namedModelIcon(metadata?.icon) || capabilityIcon(metadata?.capability);
    return <Icon className={`${sizeClass} shrink-0 opacity-70`} />;
}

function ModelHealthSummary({ video }: { video: NonNullable<ReturnType<typeof videoCapabilitiesOf>> }) {
    const stats = video.statsRecent3;
    const recent = video.recent3;
    const successRate = stats?.successRate;
    const successPercent = successRate == null ? 0 : Math.max(0, Math.min(100, successRate));
    const avgDuration = recent?.avgDurationSeconds;
    const durationBaselineSeconds = 8 * 60;
    const durationPercent = avgDuration == null ? 0 : avgDuration <= durationBaselineSeconds ? 100 : Math.max(8, Math.min(100, durationBaselineSeconds / avgDuration * 100));
    const durationColor = avgDuration == null || avgDuration <= durationBaselineSeconds ? "bg-emerald-400" : avgDuration <= 12 * 60 ? "bg-amber-400" : "bg-red-400";
    const durationIconColor = avgDuration == null || avgDuration <= durationBaselineSeconds ? "text-emerald-300" : avgDuration <= 12 * 60 ? "text-amber-300" : "text-red-300";
    const formatDuration = (seconds: number | null | undefined) => {
        if (seconds == null || !Number.isFinite(seconds)) return "暂无数据";
        if (seconds < 60) return `${Number(seconds.toFixed(1))} 秒`;
        const wholeSeconds = Math.round(seconds);
        const minutes = Math.floor(wholeSeconds / 60);
        const remainder = wholeSeconds % 60;
        return `${minutes} 分 ${String(remainder).padStart(2, "0")} 秒`;
    };
    const formatDurationCompact = (seconds: number | null | undefined) => {
        if (seconds == null || !Number.isFinite(seconds)) return "--";
        if (seconds < 60) return `${Number(seconds.toFixed(1))}″`;
        const wholeSeconds = Math.round(seconds);
        const minutes = Math.floor(wholeSeconds / 60);
        return `${minutes}′${String(wholeSeconds % 60).padStart(2, "0")}″`;
    };
    return (
        <span className="col-span-2 mt-1.5 grid w-full gap-1 border-t border-white/10 pt-1.5 text-[10px] leading-3">
            <ModelHealthMetric
                icon={BadgeCheck}
                iconClassName={successPercent < 60 ? "text-red-300" : "text-emerald-300"}
                value={`${Math.round(successPercent)}%`}
                percent={successPercent}
                barClassName={successPercent < 60 ? "bg-red-400" : "bg-emerald-400"}
                title={`成功率：${Math.round(successPercent)}% · 最近${stats?.sampleCount || 0}条任务：${stats?.successCount || 0}次成功，${stats?.failedCount || 0}次失败`}
            />
            <ModelHealthMetric
                icon={Clock3}
                iconClassName={durationIconColor}
                value={formatDurationCompact(avgDuration)}
                percent={durationPercent}
                barClassName={durationColor}
                title={avgDuration == null ? "平均耗时：最近3条任务中没有成功样本" : `平均耗时：${formatDuration(avgDuration)} · 最近3条任务中的${recent?.sampleCount || 0}次成功样本`}
            />
        </span>
    );
}

function ModelHealthMetric({ icon: Icon, iconClassName, value, percent, barClassName, title }: { icon: typeof BadgeCheck; iconClassName: string; value: string; percent: number; barClassName: string; title: string }) {
    return (
        <span className="grid w-full grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-1">
            <span className="flex w-full min-w-0 items-center gap-1 font-medium tabular-nums text-white/80">
                <Icon aria-hidden className={cn("size-3.5 shrink-0", iconClassName)} />
                <span className="truncate">{value}</span>
            </span>
            <span className="h-1 min-w-0 overflow-hidden rounded-full bg-white/10"><span className={cn("block h-full rounded-full transition-[width] duration-300", barClassName)} style={{ width: `${percent}%` }} /></span>
            <Tooltip
                title={title}
                placement="top"
                mouseEnterDelay={0.15}
                zIndex={1600}
                color="#1f2937"
                styles={{
                    container: {
                        maxWidth: 280,
                        color: "#f8fafc",
                        border: "1px solid rgba(148, 163, 184, 0.28)",
                        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.28)",
                    },
                }}
            >
                <span className="flex size-4 shrink-0 cursor-help items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white/80" aria-label={title}>
                    <CircleHelp aria-hidden className="size-3.5" />
                </span>
            </Tooltip>
        </span>
    );
}

function VideoBillingBadge({ video }: { video: NonNullable<ReturnType<typeof videoCapabilitiesOf>> }) {
    const units = Array.from(new Set(video.qualities.map((item) => item.pricing.type === "fixed_total" ? "task" : item.pricing.type === "per_second" ? "second" : null).filter((unit): unit is "task" | "second" => Boolean(unit))));
    if (!units.length) return null;
    const label = units.length === 1 ? units[0] === "task" ? "按条" : "按秒" : "按所选清晰度";
    const tone = units.length === 1 && units[0] === "task"
        ? "border-amber-300/30 bg-amber-300/12 text-amber-200"
        : units.length === 1
            ? "border-cyan-300/30 bg-cyan-300/12 text-cyan-200"
            : "border-violet-300/30 bg-violet-300/12 text-violet-200";
    return <span className={cn("pointer-events-none absolute -right-3 top-0 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-3", tone)} title={units.length === 1 ? `${label}计费` : "不同清晰度可能使用不同计费方式"}>{label}</span>;
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
