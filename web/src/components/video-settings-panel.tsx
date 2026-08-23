import { type ReactNode } from "react";
import { Input, InputNumber, Select, Slider, Switch } from "antd";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { boolConfig, isSeedanceFastModel, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedancePixelLabel, seedanceRatioOptions, seedanceResolutionOptions } from "@/lib/seedance-video";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { modelOptionName, videoCapabilitiesOf, type AiConfig, type VideoModelCapabilities, type VideoParameterDefinition } from "@/stores/use-config-store";
import type { CanvasBillingQuote } from "@/services/api/canvas-billing";

const resolutionOptions = [
    { value: "720", label: "720p" },
    { value: "480", label: "480p" },
];

const sizeOptions = [
    { value: "1280x720", label: "横屏", width: 1280, height: 720 },
    { value: "720x1280", label: "竖屏", width: 720, height: 1280 },
    { value: "1024x1024", label: "方形", width: 1024, height: 1024 },
    { value: "1792x1024", label: "宽屏", width: 1792, height: 1024 },
    { value: "1024x1792", label: "长图", width: 1024, height: 1792 },
    { value: "auto", label: "auto", width: 0, height: 0 },
];

const secondOptions = [6, 10, 12, 16, 20];

export const videoResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSizeOptions = sizeOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSecondOptions = secondOptions.map((value) => String(value));

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode" | "videoParameters", value: string) => void;
    theme: CanvasTheme;
    hasReferenceVideo?: boolean;
    showTitle?: boolean;
    className?: string;
    quote?: CanvasBillingQuote | null;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, hasReferenceVideo = false, showTitle = true, className = "w-[400px] space-y-4 px-1 py-0.5", quote = null }: VideoSettingsPanelProps) {
    const backendCapabilities = videoCapabilitiesOf(config, config.model) || videoCapabilitiesOf(config, config.videoModel);
    if (backendCapabilities) {
        return <BackendVideoSettingsPanel config={config} capabilities={backendCapabilities} onConfigChange={onConfigChange} theme={theme} hasReferenceVideo={hasReferenceVideo} showTitle={showTitle} className={className} quote={quote} />;
    }
    if (isSeedanceVideoConfig(config)) {
        return <SeedanceVideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }

    const seconds = config.videoSeconds || "6";
    const size = normalizeVideoSizeValue(config.size);
    const dimensions = readSizeDimensions(size);
    const resolution = normalizeVideoResolutionValue(config.vquality);
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
        onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <SettingGroup title="清晰度" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                        <ResolutionInput value={resolution} theme={theme} onChange={(value) => onConfigChange("vquality", value)} />
                    </div>
                </SettingGroup>
                <SettingGroup title="尺寸" color={theme.node.muted}>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("width", value)} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("height", value)} />
                    </div>
                    <div className="grid grid-cols-3 gap-2.5">
                        {sizeOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[78px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: size === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", item.value)}
                            >
                                <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.label}</span>
                                {item.value === "auto" ? null : (
                                    <span className="text-[11px] leading-none opacity-55">
                                        {item.value}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="秒数" color={theme.node.muted}>
                    <DurationSlider value={Number(seconds) || 6} min={1} max={20} theme={theme} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function BackendVideoSettingsPanel({ config, capabilities, onConfigChange, theme, hasReferenceVideo, showTitle, className, quote }: VideoSettingsPanelProps & { capabilities: VideoModelCapabilities }) {
    const quality = capabilities.qualities.some((item) => item.quality === config.vquality) ? config.vquality : capabilities.qualities[0]?.quality || "";
    const ratio = capabilities.aspectRatios.includes(config.size) ? config.size : capabilities.aspectRatios[0] || "";
    const durationOptions = [...(capabilities.duration.options || [])].sort((left, right) => left - right);
    const requestedDuration = Math.floor(Number(config.videoSeconds));
    const duration = durationOptions.length
        ? (durationOptions.includes(requestedDuration) ? requestedDuration : durationOptions[0])
        : Math.max(capabilities.duration.min ?? 1, Math.min(capabilities.duration.max ?? 60, Number.isFinite(requestedDuration) ? requestedDuration : capabilities.duration.min ?? 5));
    const selectedQuality = capabilities.qualities.find((item) => item.quality === quality) || capabilities.qualities[0];
    const normalUnitPrice = Number(selectedQuality?.pricing.normalPriceMicros || selectedQuality?.pricing.unitPriceMicros || 0) / 1_000_000;
    const quoteTier = quote?.breakdown?.tierCode;
    const tierUnitPrice = Number(quote?.breakdown?.tierUnitPriceMicros || 0) / 1_000_000;
    const payablePrice = Number(quote?.breakdown?.payableAmountMicros || quote?.maximumAmountMicros || 0) / 1_000_000;
    const originalPrice = Number(quote?.breakdown?.originalAmountMicros || 0) / 1_000_000;
    const savings = Number(quote?.breakdown?.savingsMicros || 0) / 1_000_000;
    const parameters = capabilities.parameters || [];
    const parameterValues = { ...(config.videoParameters || {}) };
    for (const parameter of parameters) if (parameterValues[parameter.key] === undefined && parameter.defaultValue !== undefined) parameterValues[parameter.key] = parameter.defaultValue;
    const updateParameter = (parameter: VideoParameterDefinition, value: unknown) => onConfigChange("videoParameters", JSON.stringify({ ...parameterValues, [parameter.key]: value }));

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="flex min-h-8 items-center justify-between gap-3"><span className="text-lg font-semibold leading-6">{capabilities.displayName}</span>{capabilities.faceFriendly ? <span className="rounded-md bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold leading-4 text-emerald-500" title={capabilities.displayNotice || undefined}>不卡人脸</span> : null}</div> : null}
                <SettingGroup title="清晰度" color={theme.node.muted}>
                    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, capabilities.qualities.length))}, minmax(0, 1fr))` }}>
                        {capabilities.qualities.map((item) => (
                            <OptionPill key={item.quality} selected={quality === item.quality} theme={theme} onClick={() => onConfigChange("vquality", item.quality)}>
                                <span className="flex flex-col items-center leading-tight">
                                    <span>{item.quality}</span>
                                    <span className="whitespace-nowrap text-[10px] font-semibold text-amber-400">普通价 ¥{(Number(item.pricing.normalPriceMicros || item.pricing.unitPriceMicros || 0) / 1_000_000).toFixed(2)}/秒</span>
                                </span>
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="画幅比例" color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2">
                        {capabilities.aspectRatios.map((value) => {
                            const preview = ratioPreview(value);
                            return (
                                <button key={value} type="button" className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border px-1 text-sm transition hover:opacity-90" style={{ borderColor: ratio === value ? theme.node.activeStroke : theme.node.stroke, background: ratio === value ? theme.toolbar.activeBg : "transparent", color: ratio === value ? theme.toolbar.activeText : theme.node.text, boxShadow: ratio === value ? `inset 0 0 0 1px ${theme.node.activeStroke}` : "none" }} onMouseDown={(event) => event.stopPropagation()} onClick={() => onConfigChange("size", value)}>
                                    <SizePreview width={preview.width} height={preview.height} color={ratio === value ? theme.toolbar.activeText : theme.node.text} />
                                    <span className="font-medium leading-5">{value}</span>
                                </button>
                            );
                        })}
                    </div>
                </SettingGroup>
                <SettingGroup title="时长" color={theme.node.muted}>
                    <DurationSlider
                        value={duration}
                        min={durationOptions[0] ?? capabilities.duration.min ?? 1}
                        max={durationOptions[durationOptions.length - 1] ?? capabilities.duration.max ?? 60}
                        options={durationOptions.length ? durationOptions : undefined}
                        theme={theme}
                        onChange={(value) => onConfigChange("videoSeconds", String(value))}
                    />
                </SettingGroup>
                {parameters.filter((parameter) => isParameterVisible(parameter, parameterValues)).length ? <SettingGroup title="模型参数" color={theme.node.muted}>
                    <div className="space-y-2 rounded-lg border p-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                        {parameters.filter((parameter) => isParameterVisible(parameter, parameterValues)).map((parameter) => <DynamicVideoParameter key={parameter.key} parameter={parameter} value={parameterValues[parameter.key]} theme={theme} onChange={(value) => updateParameter(parameter, value)} />)}
                    </div>
                </SettingGroup> : null}
                <VideoPriceSummary
                    tier={quoteTier}
                    tierUnitPrice={tierUnitPrice}
                    payablePrice={payablePrice}
                    originalPrice={originalPrice || normalUnitPrice * duration}
                    savings={savings}
                    normalUnitPrice={normalUnitPrice}
                    duration={duration}
                    theme={theme}
                />
            </div>
        </ImageSettingsTheme>
    );
}

function VideoPriceSummary({ tier, tierUnitPrice, payablePrice, originalPrice, savings, normalUnitPrice, duration, theme }: { tier?: "NORMAL" | "SILVER" | "GOLD" | "DIAMOND"; tierUnitPrice: number; payablePrice: number; originalPrice: number; savings: number; normalUnitPrice: number; duration: number; theme: CanvasTheme }) {
    const tierLabels = { NORMAL: "普通用户", SILVER: "白银", GOLD: "黄金", DIAMOND: "钻石" } as const;
    const hasLiveQuote = Boolean(tier && tierUnitPrice > 0);
    const discounted = hasLiveQuote && savings > 0;
    return (
        <div className="rounded-lg border px-3.5 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium" style={{ color: theme.node.text }}>{hasLiveQuote ? `${tierLabels[tier!]}实付价` : "价格预览"}</span>
                        {discounted ? <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-amber-400">已优惠</span> : null}
                    </div>
                    <div className="mt-1 text-[11px] leading-4" style={{ color: theme.node.muted }}>
                        {hasLiveQuote ? `¥${tierUnitPrice.toFixed(2)}/秒 × ${duration} 秒` : `普通价 ¥${normalUnitPrice.toFixed(2)}/秒 × ${duration} 秒`}
                    </div>
                </div>
                <strong className="shrink-0 text-xl font-bold leading-6 text-amber-400">¥{(hasLiveQuote ? payablePrice : originalPrice).toFixed(2)}</strong>
            </div>
            {discounted ? <div className="mt-1.5 flex items-center justify-between border-t pt-1.5 text-[11px]" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}><span>普通原价 <span className="line-through">¥{originalPrice.toFixed(2)}</span></span><strong className="font-semibold text-emerald-500">已省 ¥{savings.toFixed(2)}</strong></div> : <div className="mt-1.5 border-t pt-1.5 text-[11px] leading-4" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>{hasLiveQuote ? "当前账户按普通档位计费" : "实付金额以实时账户报价为准"}</div>}
        </div>
    );
}

function isParameterVisible(parameter: VideoParameterDefinition, values: Record<string, unknown>) {
    return !parameter.visibleWhen?.length || parameter.visibleWhen.every((condition) => {
        const current = values[condition.key];
        return condition.operator === "eq" ? current === condition.value : condition.operator === "neq" ? current !== condition.value : Array.isArray(condition.value) && condition.value.includes(current);
    });
}

function DynamicVideoParameter({ parameter, value, theme, onChange }: { parameter: VideoParameterDefinition; value: unknown; theme: CanvasTheme; onChange: (value: unknown) => void }) {
    const options = (parameter.options || []).map((option) => ({ value: option.value, label: option.label || String(option.value) }));
    return <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-xs" style={{ color: theme.node.muted }}>{parameter.label}{parameter.unit ? ` (${parameter.unit})` : ""}</span>
        <div className="min-w-0">
            {parameter.type === "toggle" ? <Switch size="small" checked={Boolean(value)} onChange={onChange} /> : parameter.type === "number" || parameter.type === "range" ? <InputNumber size="small" value={value as number} min={parameter.min} max={parameter.max} step={parameter.step || 1} onChange={(next) => onChange(next ?? undefined)} /> : parameter.type === "text" ? <Input size="small" value={value as string | undefined} onChange={(event) => onChange(event.target.value)} /> : <Select size="small" value={value} options={options} onChange={onChange} />}
        </div>
    </div>;
}

function SeedanceVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps) {
    const model = modelOptionName(config.model || config.videoModel);
    const resolution = normalizeSeedanceResolution(config.vquality, model);
    const ratio = normalizeSeedanceRatio(config.size);
    const duration = normalizeSeedanceDuration(config.videoSeconds);
    const generateAudio = boolConfig(config.videoGenerateAudio, true);
    const watermark = boolConfig(config.videoWatermark, false);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <SettingGroup title="分辨率" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {seedanceResolutionOptions.map((item) => {
                            const disabled = item.value === "1080p" && isSeedanceFastModel(model);
                            return (
                                <OptionPill key={item.value} selected={resolution === item.value} disabled={disabled} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                    {item.label}
                                </OptionPill>
                            );
                        })}
                    </div>
                    {isSeedanceFastModel(model) ? <div className="text-[11px] leading-4 opacity-55">fast 模型不支持 1080p，会自动使用 720p。</div> : null}
                </SettingGroup>
                <SettingGroup title="比例" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {seedanceRatioOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80"
                                style={{ borderColor: ratio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", item.value)}
                            >
                                <SizePreview width={ratioPreview(item.value).width} height={ratioPreview(item.value).height} color={theme.node.text} />
                                <span>{item.label}</span>
                                <span className="text-[10px] leading-none opacity-55">{item.value === "adaptive" ? "adaptive" : seedancePixelLabel(resolution, item.value)}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="时长" color={theme.node.muted}>
                    <DurationSlider value={duration} min={-1} max={15} options={[-1, ...Array.from({ length: 12 }, (_, index) => index + 4)]} theme={theme} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                </SettingGroup>
                <SettingGroup title="输出" color={theme.node.muted}>
                    <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                        <SwitchRow label="生成声音" checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                        <SwitchRow label="添加水印" checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    return `${normalizeVideoResolutionValue(value)}p`;
}

export function videoSizeLabel(value: string) {
    const ratio = normalizeSeedanceRatio(value);
    if (value === "adaptive" || value === "auto") return "自适应";
    if (ratio === value) return seedanceRatioOptions.find((item) => item.value === ratio)?.label || ratio;
    const size = normalizeVideoSizeValue(value);
    return sizeOptions.find((item) => item.value === size)?.label || size;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return "智能";
    return `${value || "6"}s`;
}

export function normalizeVideoSizeValue(value: string) {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    return ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
}

export function normalizeVideoResolutionValue(value: string) {
    if (value === "480p" || value === "low") return "480";
    if (value === "720p" || value === "auto" || value === "high" || value === "medium") return "720";
    return value.replace(/p$/i, "") || "720";
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" disabled={disabled} className="h-9 cursor-pointer rounded-lg border px-2 text-sm font-medium transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: selected ? theme.toolbar.activeBg : "transparent", borderColor: selected ? theme.node.activeStroke : theme.node.stroke, color: selected ? theme.toolbar.activeText : theme.node.text, boxShadow: selected ? `inset 0 0 0 1px ${theme.node.activeStroke}` : "none" }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-1.5">
            <div className="text-xs font-medium leading-5" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function ResolutionInput({ value, theme, onChange }: { value: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input type="number" min={1} className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} />
            <span className="grid w-7 place-items-center pr-1" style={{ color: theme.node.muted }}>
                p
            </span>
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input type="number" min={1} disabled={disabled} className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value || ""} onChange={(event) => onChange(Number(event.target.value) || null)} onMouseDown={(event) => event.stopPropagation()} />
        </label>
    );
}

function DurationSlider({ value, min, max, options, theme, onChange }: { value: number; min: number; max: number; options?: number[]; theme: CanvasTheme; onChange: (value: number) => void }) {
    const values = options?.length ? [...options].sort((left, right) => left - right) : undefined;
    const marks = values ? Object.fromEntries(values.map((item, index) => [item, index === 0 || index === values.length - 1 ? item === -1 ? "智能" : `${item}s` : ""])) : { [min]: `${min}s`, [max]: `${max}s` };
    return (
        <div className="rounded-lg border px-3 pb-3 pt-2" style={{ background: theme.node.fill, borderColor: theme.node.stroke }}>
            <div className="mb-1 flex items-center justify-between text-xs leading-5" style={{ color: theme.node.muted }}><span>拖动选择</span><strong className="text-sm font-semibold" style={{ color: theme.node.text }}>{value === -1 ? "智能" : `${value} 秒`}</strong></div>
            <Slider min={min} max={max} step={values ? null : 1} marks={marks} value={value} tooltip={{ formatter: (current) => current === -1 ? "智能" : `${current} 秒` }} onChange={onChange} />
        </div>
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function ratioPreview(ratio: string) {
    if (ratio === "9:16") return { width: 9, height: 16 };
    if (ratio === "1:1") return { width: 1, height: 1 };
    if (ratio === "4:3") return { width: 4, height: 3 };
    if (ratio === "3:4") return { width: 3, height: 4 };
    if (ratio === "21:9") return { width: 21, height: 9 };
    if (ratio === "adaptive") return { width: 0, height: 0 };
    return { width: 16, height: 9 };
}

function SwitchRow({ label, checked, theme, onChange }: { label: string; checked: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-3">
            <span className="text-sm" style={{ color: theme.node.text }}>
                {label}
            </span>
            <span onMouseDown={(event) => event.stopPropagation()}>
                <Switch size="small" checked={checked} onChange={onChange} />
            </span>
        </div>
    );
}

function readSizeDimensions(size: string) {
    if (size === "auto") return { width: 0, height: 0 };
    const match = size.match(/^(\d+)x(\d+)$/);
    return { width: Number(match?.[1]) || 1280, height: Number(match?.[2]) || 720 };
}
