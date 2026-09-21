import { useEffect, useId, useMemo, useState } from "react";
import { Popover, Tooltip } from "antd";
import { Bot, Boxes, BrainCircuit, CircleHelp, Clapperboard, Code2, Cpu, Image, MessageSquareCode, Mic, Sparkles, Star, WandSparkles } from "lucide-react";

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { decodeChannelModel, encodeChannelModel, modelIconOf, modelOptionLabel, modelOptionName, selectableModelsByCapability, useConfigStore, videoCapabilitiesOf, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { markCanvasVideoModel, unmarkCanvasVideoModel } from "@/services/api/canvas-video";

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
    const pickerTheme = canvasThemes[useThemeStore((state) => state.theme)];
    const options = useMemo(() => {
        const base = Array.from(new Set([...(config.channelMode === "local" && !capability ? [value] : []), ...selectableModelsByCapability(config, capability)].filter((model): model is string => Boolean(model))));
        return sortVideoModelsByMark(base, config);
    }, [capability, config, value]);
    const groups = useMemo(() => buildModelGroups(config, options), [config, options]);
    const current = value || "";
    const currentAlias = current ? channelAliasForModel(config, current) : "";
    const currentLabel = current ? `${displayedModelName(config, current)}${currentAlias ? ` · ${currentAlias}` : ""}` : placeholder;

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
                        ? "!w-[190px] !min-w-0 !max-w-[190px] !flex-none justify-start !shadow-none focus-visible:!border-transparent focus-visible:!outline-none focus-visible:!ring-0 data-[state=open]:!border-transparent data-[state=open]:!shadow-none data-[state=open]:!ring-0 dark:!bg-transparent dark:hover:!bg-transparent"
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
                className="z-[1200] !max-h-[min(var(--radix-select-content-available-height),32rem)] w-[22rem] max-w-[calc(100vw-24px)] !overflow-hidden rounded-lg border border-border/70 bg-popover p-0.5 text-xs shadow-xl"
                viewportClassName="!h-auto !max-h-[min(var(--radix-select-content-available-height),29rem)] overscroll-contain"
                position="popper"
                align="start"
                side="bottom"
                sideOffset={6}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {options.length ? (
                    groups.map((group) => (
                        <SelectGroup key={group.key} className="!scroll-my-0 p-0 [&+&]:mt-1">
                            <SelectLabel className="sticky top-0 z-10 mb-0.5 flex h-9 items-center gap-2.5 bg-popover px-3 pt-1 text-[10px] font-normal tracking-wide">
                                <span className={groupDividerClass()} />
                                <span className="shrink-0 leading-none" style={{ color: pickerTheme.node.muted }}>
                                    渠道<span className="font-semibold" style={{ color: groupAliasColor(group.alias, pickerTheme) }}>{group.alias}</span>
                                </span>
                                <span className={groupDividerClass()} />
                            </SelectLabel>
                            {group.models.map((model) => (
                                <SelectItem
                                    key={model}
                                    value={model}
                                    hideIndicator={Boolean(videoCapabilitiesOf(config, model))}
                                    textValue={displayedModelName(config, model)}
                                    className="relative my-1 w-full rounded-none border-0 border-b border-white/12 py-1.5 !pr-1.5 last:mb-0 data-[state=checked]:border-b-sky-300/35 data-[state=checked]:bg-sky-400/12 data-[state=checked]:shadow-[inset_3px_0_0_rgba(56,189,248,.95)] [&>span:last-child]:min-w-0 [&>span:last-child]:w-full"
                                >
                                    <ModelLabel config={config} model={model} />
                                </SelectItem>
                            ))}
                        </SelectGroup>
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

/** 已标记的模型排在最前，其余保持原有顺序（sort 稳定排序）。 */
export function sortVideoModelsByMark(models: string[], config: AiConfig): string[] {
    return [...models].sort((left, right) => Number(Boolean(videoCapabilitiesOf(config, right)?.marked)) - Number(Boolean(videoCapabilitiesOf(config, left)?.marked)));
}

type ModelGroup = { key: string; alias: string; models: string[] };

export function buildModelGroups(config: AiConfig, models: string[]): ModelGroup[] {
    const aliases = new Map(providerChannelAliases(config, models));
    const byProvider = new Map<string, string[]>();
    models.forEach((model) => {
        const key = modelChannelKey(config, model);
        byProvider.set(key, [...(byProvider.get(key) || []), model]);
    });
    return Array.from(byProvider.entries()).map(([key, providerModels]) => {
        const alias = aliases.get(key) || "?";
        return { key, alias, models: sortVideoModelsByMark(providerModels, config) };
    });
}

/**
 * Aliases come from the backend provider key (aistartlab / hot-apis / modelhub /
 * xkmjai ...), not from each route. A provider owns many routes, so grouping by
 * route produced a badge per route and the user only ever saw their first few.
 * Ordering is fixed so a provider keeps its letter for the whole session.
 */
function providerChannelAliases(config: AiConfig, models: string[]) {
    return providerKeys(config, models).map((key) => [key, providerChannelAlias(config, key)] as const);
}

function providerKeys(config: AiConfig, models: string[]) {
    const keys = new Set<string>();
    [...models, ...config.channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name)))].forEach((model) => keys.add(modelChannelKey(config, model)));
    return Array.from(keys).sort((left, right) => compareChannelKeys(config, left, right));
}

/**
 * Prefer the backend-configured alias. The fallback exists only for local/offline
 * configurations created before channel_alias was added.
 */
function providerChannelAlias(config: AiConfig, key: string) {
    const configured = configuredChannelAlias(config, key);
    if (configured) return configured;
    const index = PROVIDER_ORDER.indexOf(key.toLowerCase());
    return index < 0 ? "?" : channelAlias(index);
}

function configuredChannelAlias(config: AiConfig, key: string) {
    const normalized = key.trim().toLowerCase();
    for (const channel of config.channels) {
        for (const model of channel.models) {
            const video = model.videoCapabilities;
            if (!video?.channelAlias) continue;
            const provider = (video.upstreamProvider || video.channel || channel.id).trim().toLowerCase();
            if (provider === normalized) return video.channelAlias.trim().toUpperCase();
        }
    }
    return "";
}

function providerSortIndex(config: AiConfig, key: string) {
    const alias = providerChannelAlias(config, key);
    const rank = alias.charCodeAt(0) - 64;
    if (rank >= 1 && rank <= 26) return rank;
    const index = PROVIDER_ORDER.indexOf(key.toLowerCase());
    return index < 0 ? PROVIDER_ORDER.length + 1 : index + 1;
}

const PROVIDER_ORDER = ["aistartlab", "hot-apis", "modelhub", "xkmjai", "boyesir", "paipu"];

function channelAlias(index: number) {
    return index >= 0 && index < 26 ? String.fromCharCode(65 + index) : `C${index + 1}`;
}

export function channelAliasForModel(config: AiConfig, model: string) {
    return channelAliases(config).get(modelChannelKey(config, model)) || "";
}

/**
 * Aliases are assigned from the sorted set of real backend channel keys, never from
 * the order the backend happened to return models in. Without this, two channels can
 * swap their A/B labels whenever the remote catalog is reordered or a price changes
 * and a model moves position in the list.
 */
function channelAliases(config: AiConfig) {
    const aliases = new Map<string, string>();
    providerKeys(config, []).forEach((key) => {
        aliases.set(key, providerChannelAlias(config, key));
    });
    return aliases;
}

function compareChannelKeys(config: AiConfig, left: string, right: string) {
    if (left === right) return 0;
    if (left === "__other__") return 1;
    if (right === "__other__") return -1;
    const leftProvider = providerSortIndex(config, left);
    const rightProvider = providerSortIndex(config, right);
    if (leftProvider !== PROVIDER_ORDER.length + 1 || rightProvider !== PROVIDER_ORDER.length + 1) {
        if (leftProvider === PROVIDER_ORDER.length + 1) return 1;
        if (rightProvider === PROVIDER_ORDER.length + 1) return -1;
        return leftProvider - rightProvider;
    }
    const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
    const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
    if (leftNumber != null && rightNumber != null) return leftNumber - rightNumber;
    if (leftNumber != null) return -1;
    if (rightNumber != null) return 1;
    return left < right ? -1 : 1;
}

function modelChannelKey(config: AiConfig, model: string) {
    const video = videoCapabilitiesOf(config, model);
    return video?.upstreamProvider?.trim() || video?.channel?.trim() || decodeChannelModel(model)?.channelId || "__other__";
}

function groupAliasColor(alias: string, theme: CanvasTheme) {
    const colors: Record<string, string> = { A: "#38bdf8", B: "#a78bfa", C: "#34d399", D: "#fbbf24", E: "#fb7185" };
    return colors[alias] || theme.node.muted;
}

function groupDividerClass() {
    return "h-px flex-1 bg-slate-400/35 dark:bg-slate-400/25";
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability === "image" ? "生图" : capability === "video" ? "视频" : capability === "text" ? "文本" : capability === "audio" ? "音频" : "";
    if (capability && config.models.length) return `请先在渠道里为${label}指定模型`;
    return config.models.length ? `暂无匹配的${label}模型` : "请先到配置里添加渠道和模型";
}

function displayedModelName(config: AiConfig, model: string) {
    const video = videoCapabilitiesOf(config, model);
    return video?.displayBaseName?.trim() || video?.displayName?.trim() || modelOptionLabel(config, model);
}

function ModelLabel({ config, model }: { config: AiConfig; model: string }) {
    const video = videoCapabilitiesOf(config, model);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const setVideoModelMarked = useConfigStore((state) => state.setVideoModelMarked);
    const [markPending, setMarkPending] = useState(false);
    if (video) {
        const name = displayedModelName(config, model);
        const toggleMark = async (event: React.MouseEvent) => {
            event.stopPropagation();
            event.preventDefault();
            if (markPending) return;
            const decoded = decodeChannelModel(model);
            const modelKey = decoded ? decoded.model : model;
            const next = !video.marked;
            setMarkPending(true);
            setVideoModelMarked(model, next);
            try {
                if (next) await markCanvasVideoModel(config, modelKey, video.displayName);
                else await unmarkCanvasVideoModel(config, modelKey);
            } catch {
                setVideoModelMarked(model, !next);
            } finally {
                setMarkPending(false);
            }
        };
        const primaryRow = (
            <span className="grid min-h-9 w-full min-w-0 grid-cols-[32px_minmax(0,1fr)_auto_auto] items-center gap-x-2" aria-label={name}>
                {video.isRecommended ? <span className="absolute left-0 top-0 z-10 flex h-[22px] w-[26px] justify-start bg-amber-400 pl-1 pt-[3px] text-[10px] font-bold leading-none text-amber-950 [clip-path:polygon(0_0,100%_0,0_100%)]" aria-label="官方推荐">荐</span> : null}
                <ModelIcon config={config} model={model} large />
                <span className="relative min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium leading-4">{name}</span>
                </span>
                <VideoBillingBadge video={video} />
                <button
                    type="button"
                    className="group flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-amber-400/10"
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={toggleMark}
                    title={video.marked ? "取消标记" : "标记该模型，下次置顶显示"}
                    aria-label={video.marked ? "取消标记" : "标记该模型"}
                >
                    <Star className={cn("size-3.5 transition-colors group-hover:!text-yellow-200", video.marked ? "!text-yellow-300" : "!text-amber-400")} fill={video.marked ? "currentColor" : "none"} />
                </button>
            </span>
        );

        return (
            <Popover
                trigger="hover"
                placement="rightTop"
                align={{ offset: [14, 0] }}
                arrow={false}
                zIndex={1300}
                mouseEnterDelay={0.12}
                mouseLeaveDelay={0.16}
                content={<ModelDetail video={video} config={config} model={model} />}
                styles={{ container: { background: theme.toolbar.panel, border: `1px solid ${theme.toolbar.border}`, borderRadius: 8, boxShadow: "0 16px 36px rgba(0, 0, 0, .28)" }, content: { padding: 0, overflow: "hidden" } }}
            >
                {primaryRow}
            </Popover>
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

function ModelDetail({ video, config, model }: { video: NonNullable<ReturnType<typeof videoCapabilitiesOf>>; config: AiConfig; model: string }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const name = displayedModelName(config, model);
    const alias = channelAliasForModel(config, model);
    const suffix = video.displaySuffix?.trim();
    const channelDescription = [alias ? `渠道 ${alias}` : "", video.channel?.trim(), video.routeLabel?.trim(), suffix].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index).join(" · ") || "视频模型";
    const durationLabel = formatVideoDurationRange(video.duration);
    const ratioLabel = video.aspectRatios.length ? video.aspectRatios.join("、") : "不限";
    const modeLabel = video.modes.length ? video.modes.map(videoModeLabel).join("、") : "未提供";

    return (
        <div className="w-[292px] max-w-[calc(100vw-32px)] p-3 text-xs" data-canvas-no-zoom style={{ color: theme.node.text }}>
            <div className="flex min-w-0 items-start gap-2.5">
                <ModelIcon config={config} model={model} large />
                <div className="min-w-0 flex-1">
                    <div className="break-words text-sm font-semibold leading-5" title={name}>{name}</div>
                    <div className="mt-0.5 break-words text-[11px] leading-4" style={{ color: theme.node.muted }}>{channelDescription}</div>
                </div>
                <VideoBillingBadge video={video} />
            </div>
            {video.freePromotion?.active ? <div className="mt-2 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-500" style={{ background: "rgba(16, 185, 129, .12)" }}>{video.freePromotion.label || "限时优惠"}</div> : null}
            {video.displayNotice ? <div className="mt-2 rounded-md px-2 py-1 text-[11px]" style={{ color: theme.node.muted, background: theme.toolbar.activeBg }}>{video.displayNotice}</div> : null}
            <div className="mt-3 grid gap-1.5 border-t pt-2.5 text-[11px]" style={{ borderColor: theme.toolbar.border, color: theme.node.muted }}>
                <div className="flex items-start justify-between gap-3"><span className="shrink-0">输入上限</span><span className="whitespace-normal break-words text-right" style={{ color: theme.node.text }}>图片 {video.inputImagesMax} · 视频 {video.inputVideosMax} · 音频 {video.inputAudiosMax}</span></div>
                <div className="flex items-start justify-between gap-3"><span className="shrink-0">支持画幅</span><span className="whitespace-normal break-words text-right" style={{ color: theme.node.text }}>{ratioLabel}</span></div>
                <div className="flex items-start justify-between gap-3"><span className="shrink-0">生成时长</span><span className="whitespace-normal break-words text-right" style={{ color: theme.node.text }}>{durationLabel}</span></div>
                <div className="flex items-start justify-between gap-3"><span className="shrink-0">生成模式</span><span className="max-w-[190px] whitespace-normal break-words text-right" style={{ color: theme.node.text }}>{modeLabel}</span></div>
            </div>
            <VideoTierPriceSummary video={video} theme={theme} />
            <ModelHealthSummary video={video} />
        </div>
    );
}

function VideoTierPriceSummary({ video, theme }: { video: NonNullable<ReturnType<typeof videoCapabilitiesOf>>; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const rows = video.qualities.filter((item) => item.pricing.tierPricesMicros || item.pricing.normalPriceMicros || item.pricing.unitPriceMicros);
    if (!rows.length) return null;
    const tiers = ["NORMAL", "SILVER", "GOLD", "DIAMOND"] as const;
    const labels = { NORMAL: "普通", SILVER: "白银", GOLD: "黄金", DIAMOND: "钻石" } as const;
    return <div className="mt-3 border-t pt-2.5 text-[10px]" style={{ borderColor: theme.toolbar.border }}><div className="mb-1.5 font-medium" style={{ color: theme.node.text }}>会员价格</div><div className="overflow-hidden rounded-md border" style={{ borderColor: theme.toolbar.border }}><table className="w-full table-fixed border-collapse" style={{ color: theme.node.muted }}><thead><tr className="border-b" style={{ borderColor: theme.toolbar.border }}><th className="w-[17%] px-1.5 py-1 text-left font-medium">清晰度</th>{tiers.map((tier) => <th key={tier} className="border-l px-1 py-1 text-left font-medium" style={{ borderColor: theme.toolbar.border }}>{labels[tier]}</th>)}</tr></thead><tbody>{rows.map((item) => <PriceRow key={item.quality} item={item} tiers={tiers} theme={theme} />)}</tbody></table></div></div>;
}

function PriceRow({ item, tiers, theme }: { item: NonNullable<ReturnType<typeof videoCapabilitiesOf>>["qualities"][number]; tiers: readonly ["NORMAL", "SILVER", "GOLD", "DIAMOND"]; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const unit = item.pricing.type === "fixed_total" ? "条" : "秒";
    const fallback = Number(item.pricing.normalPriceMicros || item.pricing.unitPriceMicros || 0);
    return <tr className="border-b last:border-b-0" style={{ borderColor: theme.toolbar.border }}><th className="px-1.5 py-1 text-left font-medium" style={{ color: theme.node.text }}>{item.quality}</th>{tiers.map((tier) => { const value = Number(item.pricing.tierPricesMicros?.[tier] || (tier === "NORMAL" ? fallback : 0)); return <td key={tier} className={`border-l px-1 py-1 text-left whitespace-nowrap ${tier === "DIAMOND" ? "font-medium text-emerald-400" : ""}`} style={{ borderColor: theme.toolbar.border }}>{value > 0 ? `¥${(value / 1_000_000).toFixed(2)}/${unit}` : "--"}</td>; })}</tr>;
}

function ModelHealthSummary({ video }: { video: NonNullable<ReturnType<typeof videoCapabilitiesOf>> }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const stats = video.statsRecent3;
    const recent = video.recent3;
    const successRate = stats?.successRate;
    const successPercent = successRate == null ? 0 : Math.max(0, Math.min(100, successRate));
    const avgDuration = recent?.avgDurationSeconds;
    const durationBaselineSeconds = 8 * 60;
    const durationPercent = avgDuration == null ? 0 : avgDuration <= durationBaselineSeconds ? 100 : Math.max(8, Math.min(100, durationBaselineSeconds / avgDuration * 100));
    const durationColor = avgDuration == null || avgDuration <= durationBaselineSeconds ? "bg-emerald-400" : avgDuration <= 12 * 60 ? "bg-amber-400" : "bg-red-400";
    const durationValueColor = avgDuration == null || avgDuration <= durationBaselineSeconds ? "text-emerald-300" : avgDuration <= 12 * 60 ? "text-amber-300" : "text-red-300";
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
        <span className="col-span-2 mt-3 grid w-full gap-1 border-t pt-2.5 text-[10px] leading-3" style={{ borderColor: theme.toolbar.border }}>
            <ModelHealthMetric
                label="成功率"
                value={`${Math.round(successPercent)}%`}
                valueClassName={successPercent < 60 ? "text-red-300" : "text-emerald-300"}
                percent={successPercent}
                barClassName={successPercent < 60 ? "bg-red-400" : "bg-emerald-400"}
                title={`成功率：${Math.round(successPercent)}% · 最近${stats?.sampleCount || 0}条任务：${stats?.successCount || 0}次成功，${stats?.failedCount || 0}次失败`}
                theme={theme}
            />
            <ModelHealthMetric
                label="平均耗时"
                value={formatDurationCompact(avgDuration)}
                valueClassName={durationValueColor}
                percent={durationPercent}
                barClassName={durationColor}
                title={avgDuration == null ? "平均耗时：最近3条任务中没有成功样本" : `平均耗时：${formatDuration(avgDuration)} · 最近3条任务中的${recent?.sampleCount || 0}次成功样本`}
                theme={theme}
            />
        </span>
    );
}

function ModelHealthMetric({ label, value, valueClassName, percent, barClassName, title, theme }: { label: string; value: string; valueClassName: string; percent: number; barClassName: string; title: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return (
        <span className="grid w-full grid-cols-[108px_minmax(0,1fr)_auto] items-center gap-1">
            <span className="flex w-full min-w-0 items-center justify-between gap-1.5 font-medium tabular-nums">
                <span style={{ color: theme.node.muted }}>{label}</span>
                <span className={valueClassName}>{value}</span>
            </span>
            <span className="h-1 min-w-0 overflow-hidden rounded-full" style={{ background: theme.node.stroke }}><span className={cn("block h-full rounded-full transition-[width] duration-300", barClassName)} style={{ width: `${percent}%` }} /></span>
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
                <span className="flex size-4 shrink-0 cursor-help items-center justify-center rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.muted }} aria-label={title}>
                    <CircleHelp aria-hidden className="size-3.5" />
                </span>
            </Tooltip>
        </span>
    );
}

function VideoBillingBadge({ video }: { video: NonNullable<ReturnType<typeof videoCapabilitiesOf>> }) {
    const units = Array.from(new Set(video.qualities.map((item) => item.pricing.type === "fixed_total" ? "task" : item.pricing.type === "per_second" ? "second" : null).filter((unit): unit is "task" | "second" => Boolean(unit))));
    if (!units.length) return null;
    const label = videoBillingBadgeLabel(video);
    const tone = units.length === 1 && units[0] === "task"
        ? "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-300/30 dark:bg-amber-300/12 dark:text-amber-200"
        : units.length === 1
            ? "border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-300/30 dark:bg-cyan-300/12 dark:text-cyan-200"
            : "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-300/30 dark:bg-violet-300/12 dark:text-violet-200";
    return <span className={cn("pointer-events-none shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-3 tabular-nums", tone)} title={units.length === 1 ? `钻石会员价 ${label}` : "不同清晰度可能使用不同计费方式"}>{label}</span>;
}

export function videoBillingBadgeLabel(video: NonNullable<ReturnType<typeof videoCapabilitiesOf>>) {
    const declaredUnits = Array.from(new Set(video.qualities.map((item) => item.pricing.type === "fixed_total" ? "task" : item.pricing.type === "per_second" ? "second" : null).filter((unit): unit is "task" | "second" => Boolean(unit))));
    const entries = video.qualities.map((item) => {
        const unit = item.pricing.type === "fixed_total" ? "task" : item.pricing.type === "per_second" ? "second" : null;
        const micros = Number(item.pricing.tierPricesMicros?.DIAMOND || item.pricing.normalPriceMicros || item.pricing.unitPriceMicros || 0);
        return unit && Number.isFinite(micros) && micros > 0 ? { unit, micros } : null;
    }).filter((item): item is { unit: "task" | "second"; micros: number } => Boolean(item));
    const units = Array.from(new Set(entries.map((item) => item.unit)));
    if (!entries.length && declaredUnits.length === 1) return declaredUnits[0] === "task" ? "按条" : "按秒";
    if (!entries.length) return units.length ? "按所选清晰度" : "";
    return units.map((unit) => {
        const prices = entries.filter((item) => item.unit === unit).map((item) => item.micros);
        const minimum = Math.min(...prices);
        return `¥${formatVideoBadgePrice(minimum / 1_000_000)}/${unit === "task" ? "条" : "秒"}`;
    }).join(" · ");
}

function formatVideoBadgePrice(value: number) {
    return value.toFixed(2);
}

function formatVideoDurationRange(duration: NonNullable<NonNullable<ReturnType<typeof videoCapabilitiesOf>>["duration"]>) {
    const options = duration.options?.filter((value) => Number.isFinite(value) && value > 0) || [];
    if (options.length) return options.map((value) => `${value}s`).join("、");
    const min = duration.min;
    const max = duration.max;
    if (min != null && max != null) return min === max ? `${min}s` : `${min}-${max}s`;
    if (min != null) return `${min}s 起`;
    if (max != null) return `最长 ${max}s`;
    return "未提供";
}

function videoModeLabel(mode: string) {
    if (mode === "text2video") return "文生视频";
    if (mode === "image2video") return "全能参考";
    if (mode === "reference2video") return "全能参考";
    if (mode === "frames2video") return "首尾帧";
    if (mode === "first-frame-to-video") return "首帧生视频";
    return mode || "视频模式";
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
