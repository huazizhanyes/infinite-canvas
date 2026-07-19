import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, LoaderCircle, Pause, Play, Search, X } from "lucide-react";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { audioFormatLabel, audioFormatOptions, audioSpeedLabel, audioVoiceOptions, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { decodeChannelModel, type AiConfig } from "@/stores/use-config-store";
import { listCanvasAudioVoices, type CanvasAudioVoice, type CanvasVoiceFavoriteCategory } from "@/services/api/audio";

const speedOptions = ["0.75", "1", "1.25", "1.5"];

type AudioSettingKey = "audioVoice" | "audioVoiceName" | "audioFormat" | "audioSpeed" | "audioInstructions";

type AudioSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: AudioSettingKey, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function AudioSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: AudioSettingsPanelProps) {
    const voice = normalizeAudioVoiceValue(config.audioVoice);
    const format = normalizeAudioFormatValue(config.audioFormat);
    const speed = normalizeAudioSpeedValue(config.audioSpeed);
    const isCanvasTts = decodeChannelModel(config.model)?.channelId === "sucai-canvas";
    const isVoxCpm2 = isCanvasTts && decodeChannelModel(config.model)?.model === "voxcpm2";
    const [search, setSearch] = useState("");
    const [voices, setVoices] = useState<CanvasAudioVoice[]>([]);
    const [favoriteCategories, setFavoriteCategories] = useState<CanvasVoiceFavoriteCategory[]>([]);
    const [favoriteCount, setFavoriteCount] = useState(0);
    const [voiceScope, setVoiceScope] = useState("all");
    const [voicesLoading, setVoicesLoading] = useState(false);
    const [voicesError, setVoicesError] = useState("");
    const [playingVoiceId, setPlayingVoiceId] = useState<number | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        if (!isCanvasTts) return;
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            setVoicesLoading(true);
            setVoicesError("");
            const categoryId = voiceScope.startsWith("category:") ? Number(voiceScope.slice("category:".length)) : undefined;
            const scope = voiceScope === "private" ? "private" : voiceScope === "favorites" || categoryId ? "favorites" : "all";
            void listCanvasAudioVoices(config, { search: search.trim(), scope, categoryId }, controller.signal)
                .then((result) => {
                    setVoices(result.voices);
                    setFavoriteCategories(result.favoriteCategories);
                    setFavoriteCount(result.favoriteCount);
                    const selectedVoice = result.voices.find((item) => String(item.id) === String(config.audioVoice));
                    if (selectedVoice && config.audioVoiceName !== selectedVoice.displayName) {
                        onConfigChange("audioVoiceName", selectedVoice.displayName);
                    } else if (result.voices[0] && (!Number.isInteger(Number(config.audioVoice)) || Number(config.audioVoice) <= 0)) {
                        onConfigChange("audioVoice", String(result.voices[0].id));
                        onConfigChange("audioVoiceName", result.voices[0].displayName);
                    }
                })
                .catch((error) => {
                    if (!controller.signal.aborted) setVoicesError(error instanceof Error ? error.message : "音色读取失败");
                })
                .finally(() => {
                    if (!controller.signal.aborted) setVoicesLoading(false);
                });
        }, 250);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [config.model, config.baseUrl, config.apiKey, isCanvasTts, search, voiceScope]);

    useEffect(() => {
        if (isVoxCpm2 && format !== "wav") onConfigChange("audioFormat", "wav");
    }, [format, isVoxCpm2]);

    useEffect(() => () => audioRef.current?.pause(), []);

    const togglePreview = (item: CanvasAudioVoice) => {
        if (playingVoiceId === item.id) {
            audioRef.current?.pause();
            setPlayingVoiceId(null);
            return;
        }
        audioRef.current?.pause();
        const audio = new Audio(item.preview_url);
        audioRef.current = audio;
        setPlayingVoiceId(item.id);
        audio.addEventListener("ended", () => setPlayingVoiceId(null), { once: true });
        void audio.play().catch(() => setPlayingVoiceId(null));
    };

    const selectCanvasVoice = (item: CanvasAudioVoice) => {
        onConfigChange("audioVoice", String(item.id));
        onConfigChange("audioVoiceName", item.displayName);
    };

    const selectedVoiceName = config.audioVoiceName || voices.find((item) => String(item.id) === voice)?.displayName || audioVoiceOptions.find((item) => item.value === voice)?.label || "未选择音色";
    const outputSettings = (
        <div className="min-w-0 space-y-5">
            <SettingGroup title="输出格式" color={theme.node.muted}>
                <div className="grid grid-cols-3 gap-2">
                    {audioFormatOptions
                        .filter((item) => !isCanvasTts || (isVoxCpm2 ? item.value === "wav" : ["wav", "mp3", "flac"].includes(item.value)))
                        .map((item) => (
                            <OptionPill key={item.value} selected={format === item.value} theme={theme} onClick={() => onConfigChange("audioFormat", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                </div>
            </SettingGroup>
            <SettingGroup title="语速" color={theme.node.muted}>
                <div className="grid grid-cols-4 gap-2">
                    {speedOptions.map((value) => (
                        <OptionPill key={value} selected={speed === value} theme={theme} onClick={() => onConfigChange("audioSpeed", value)}>
                            {audioSpeedLabel(value)}
                        </OptionPill>
                    ))}
                </div>
                <label className="flex h-10 items-center gap-3 rounded-md border px-3" style={{ background: theme.node.fill, borderColor: theme.node.stroke }}>
                    <span className="shrink-0 text-xs" style={{ color: theme.node.muted }}>
                        自定义
                    </span>
                    <input
                        type="number"
                        min={isCanvasTts ? 0.5 : 0.25}
                        max={isCanvasTts ? 2 : 4}
                        step={0.05}
                        className="min-w-0 flex-1 bg-transparent text-right text-sm font-medium outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                        value={config.audioSpeed || "1"}
                        onChange={(event) => onConfigChange("audioSpeed", event.target.value)}
                        onBlur={(event) => onConfigChange("audioSpeed", isCanvasTts ? normalizeCanvasAudioSpeed(event.target.value) : normalizeAudioSpeedValue(event.target.value))}
                        onMouseDown={(event) => event.stopPropagation()}
                    />
                    <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                        x
                    </span>
                </label>
            </SettingGroup>
            <SettingGroup title={isCanvasTts ? "情绪 / 控制指令" : "声音指令"} color={theme.node.muted}>
                <textarea
                    value={config.audioInstructions || ""}
                    placeholder="例如：自然、温暖、适合旁白。"
                    className="thin-scrollbar h-28 w-full resize-none rounded-md border px-3 py-2.5 text-sm leading-5 outline-none"
                    style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                    onChange={(event) => onConfigChange("audioInstructions", event.target.value)}
                    onMouseDown={(event) => event.stopPropagation()}
                />
            </SettingGroup>
        </div>
    );

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? (
                    <header className="mb-5 flex min-w-0 items-start justify-between gap-4 border-b pb-4" style={{ borderColor: theme.node.stroke }}>
                        <div className="min-w-0">
                            <div className="text-base font-semibold">音频设置</div>
                            <div className="mt-1 truncate text-xs" style={{ color: theme.node.faint }}>
                                {selectedVoiceName} · {audioFormatLabel(format)} · {audioSpeedLabel(speed)}
                            </div>
                        </div>
                    </header>
                ) : null}
                {isCanvasTts ? (
                    <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(230px,0.8fr)]">
                        <section className="min-w-0">
                            <div className="mb-2.5 flex items-center justify-between gap-3">
                                <h3 className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                    音色库
                                </h3>
                                {!voicesLoading ? (
                                    <span className="text-[11px]" style={{ color: theme.node.faint }}>
                                        {voices.length} 个
                                    </span>
                                ) : null}
                            </div>
                            <label className="flex h-10 min-w-0 items-center gap-2 rounded-md border px-3" style={{ background: theme.node.fill, borderColor: theme.node.stroke }}>
                                <Search className="size-4 shrink-0" style={{ color: theme.node.faint }} />
                                <input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="搜索音色名称"
                                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-60"
                                    style={{ color: theme.node.text }}
                                />
                                {search ? (
                                    <button type="button" className="grid size-6 shrink-0 place-items-center rounded-md transition hover:opacity-70" onClick={() => setSearch("")} aria-label="清空搜索" title="清空搜索">
                                        <X className="size-3.5" />
                                    </button>
                                ) : null}
                            </label>
                            <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-md p-1" style={{ background: theme.node.fill }}>
                                <VoiceScopeButton label="全部" selected={voiceScope === "all"} onClick={() => setVoiceScope("all")} theme={theme} />
                                <VoiceScopeButton label="我的" selected={voiceScope === "private"} onClick={() => setVoiceScope("private")} theme={theme} />
                                <VoiceScopeButton label={`收藏 ${favoriteCount}`} selected={voiceScope === "favorites" || voiceScope.startsWith("category:")} onClick={() => setVoiceScope("favorites")} theme={theme} />
                            </div>
                            {(voiceScope === "favorites" || voiceScope.startsWith("category:")) && favoriteCategories.length ? (
                                <div className="thin-scrollbar mt-2.5 flex gap-1.5 overflow-x-auto pb-1">
                                    <VoiceCategoryButton label="全部收藏" selected={voiceScope === "favorites"} onClick={() => setVoiceScope("favorites")} theme={theme} />
                                    {favoriteCategories.map((category) => (
                                        <VoiceCategoryButton key={category.id} label={`${category.name} ${category.count}`} selected={voiceScope === `category:${category.id}`} onClick={() => setVoiceScope(`category:${category.id}`)} theme={theme} />
                                    ))}
                                </div>
                            ) : null}
                            <div className="thin-scrollbar mt-3 grid max-h-[304px] grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                                {voicesLoading ? (
                                    <div className="col-span-full grid h-32 place-items-center">
                                        <LoaderCircle className="size-5 animate-spin" style={{ color: theme.node.muted }} />
                                    </div>
                                ) : voicesError ? (
                                    <div className="col-span-full grid h-32 place-items-center px-4 text-center text-xs text-red-400">{voicesError}</div>
                                ) : voices.length ? (
                                    voices.map((item) => {
                                        const selected = String(item.id) === voice;
                                        return (
                                            <div
                                                key={item.id}
                                                className="flex h-16 min-w-0 items-center gap-1.5 rounded-md border p-1.5 transition"
                                                style={{ background: selected ? theme.toolbar.activeBg : "transparent", borderColor: selected ? theme.node.activeStroke : theme.node.stroke }}
                                            >
                                                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => selectCanvasVoice(item)} aria-label={`选择${item.displayName}`}>
                                                    <span className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-md text-sm font-medium" style={{ background: theme.node.fill }}>
                                                        {item.avatar ? <img src={item.avatar} alt="" className="size-full object-cover" /> : item.displayName.slice(0, 1)}
                                                        {selected ? (
                                                            <span className="absolute right-0.5 top-0.5 grid size-4 place-items-center rounded-full" style={{ background: theme.node.activeStroke, color: theme.node.panel }}>
                                                                <Check className="size-2.5" />
                                                            </span>
                                                        ) : null}
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-xs font-medium" title={item.displayName}>
                                                            {item.displayName}
                                                        </span>
                                                        <span className="mt-1 block truncate text-[10px]" style={{ color: theme.node.faint }}>
                                                            {voiceMeta(item)}
                                                        </span>
                                                    </span>
                                                </button>
                                                <button
                                                    type="button"
                                                    className="grid size-8 shrink-0 place-items-center rounded-md transition hover:opacity-75"
                                                    style={{ background: playingVoiceId === item.id ? theme.node.activeStroke : theme.node.fill, color: playingVoiceId === item.id ? theme.node.panel : theme.node.text }}
                                                    onClick={() => togglePreview(item)}
                                                    aria-label={playingVoiceId === item.id ? "暂停试听" : "试听音色"}
                                                    title={playingVoiceId === item.id ? "暂停试听" : "试听音色"}
                                                >
                                                    {playingVoiceId === item.id ? <Pause className="size-3.5 fill-current" /> : <Play className="size-3.5 fill-current" />}
                                                </button>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="col-span-full grid h-32 place-items-center text-xs" style={{ color: theme.node.faint }}>
                                        暂无可用音色
                                    </div>
                                )}
                            </div>
                        </section>
                        <aside className="min-w-0 border-t pt-5 md:border-l md:border-t-0 md:pl-5 md:pt-0" style={{ borderColor: theme.node.stroke }}>
                            {outputSettings}
                        </aside>
                    </div>
                ) : (
                    <div className="space-y-5">
                        <SettingGroup title="声音" color={theme.node.muted}>
                            <div className="grid grid-cols-3 gap-2.5">
                                {audioVoiceOptions.map((item) => (
                                    <OptionPill
                                        key={item.value}
                                        selected={voice === item.value}
                                        theme={theme}
                                        onClick={() => {
                                            onConfigChange("audioVoice", item.value);
                                            onConfigChange("audioVoiceName", item.label);
                                        }}
                                    >
                                        {item.label}
                                    </OptionPill>
                                ))}
                            </div>
                        </SettingGroup>
                        {outputSettings}
                    </div>
                )}
            </div>
        </ImageSettingsTheme>
    );
}

function VoiceScopeButton({ label, selected, onClick, theme }: { label: string; selected: boolean; onClick: () => void; theme: CanvasTheme }) {
    return (
        <button
            type="button"
            className="h-8 min-w-0 truncate rounded-md px-2 text-xs font-medium transition"
            style={{ background: selected ? theme.toolbar.activeBg : "transparent", color: selected ? theme.toolbar.activeText : theme.node.muted }}
            onClick={onClick}
        >
            {label}
        </button>
    );
}

function VoiceCategoryButton({ label, selected, onClick, theme }: { label: string; selected: boolean; onClick: () => void; theme: CanvasTheme }) {
    return (
        <button
            type="button"
            className="h-7 shrink-0 rounded-full border px-2.5 text-[11px] transition"
            style={{ background: selected ? theme.toolbar.activeBg : "transparent", borderColor: selected ? theme.node.activeStroke : theme.node.stroke, color: selected ? theme.toolbar.activeText : theme.node.muted }}
            onClick={onClick}
        >
            {label}
        </button>
    );
}

function normalizeCanvasAudioSpeed(value: string) {
    const speed = Number(value);
    if (!Number.isFinite(speed)) return "1";
    return String(Math.max(0.5, Math.min(2, Number(speed.toFixed(2)))));
}

function voiceMeta(item: CanvasAudioVoice) {
    const details = [item.gender, item.age_group, item.style].filter(Boolean).slice(0, 2);
    if (details.length) return details.join(" · ");
    if (item.is_private) return "我的音色";
    if (item.isFavorite) return "已收藏";
    return "公共音色";
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-9 cursor-pointer rounded-md border px-2 text-sm transition hover:opacity-80"
            style={{ background: selected ? theme.toolbar.activeBg : "transparent", borderColor: selected ? theme.node.activeStroke : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}
