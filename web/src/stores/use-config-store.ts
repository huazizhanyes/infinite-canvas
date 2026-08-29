import { useMemo } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { nanoid } from "nanoid";
import { accountScopedKey } from "@/lib/canvas-account-scope";
import { localForageStorage } from "@/lib/localforage-storage";

export type ApiCallFormat = "openai" | "gemini";
export type ModelCapability = "image" | "video" | "text" | "audio";
export const MIN_VIDEO_DURATION_SECONDS = 5;

export type VideoParameterOption = { value: string | number | boolean; label?: string };
export type VideoParameterDefinition = {
    key: string;
    label: string;
    type: "select" | "segmented" | "range" | "number" | "toggle" | "text";
    defaultValue?: unknown;
    options?: VideoParameterOption[];
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    required?: boolean;
    upstreamKey?: string;
    priceAffects?: boolean;
    visibleWhen?: Array<{ key: string; operator: "eq" | "neq" | "in"; value: unknown }>;
};
export type VideoModeRule = {
    mode: string;
    inputImagesMin?: number;
    inputImagesMax?: number;
    inputVideosMin?: number;
    inputVideosMax?: number;
    inputAudiosMin?: number;
    inputAudiosMax?: number;
};

export type VideoModelCapabilities = {
    provider: "canvas-video";
    displayName: string;
    displayBaseName?: string;
    displaySuffix?: string | null;
    channel: string;
    routeLabel?: string;
    upstreamModel: string;
    pricingVersion?: number;
    qualities: Array<{ quality: string; pricingVersion?: number; pricing: { type: string; currency?: "CNY"; unitPriceMicros?: number; normalPriceMicros?: number; credits?: number; inputVideoMultiplier?: number } }>;
    aspectRatios: string[];
    duration: { min?: number | null; max?: number | null; options?: number[] | null };
    modes: string[];
    inputImagesMax: number;
    inputVideosMax: number;
    inputAudiosMax: number;
    parameters?: VideoParameterDefinition[];
    modeRules?: VideoModeRule[];
    faceFriendly?: boolean;
    displayNotice?: string | null;
};

export function normalizeVideoDuration(value: string | number | undefined, range?: VideoModelCapabilities["duration"] | null) {
    const requested = Math.floor(Number(value));
    const rawMax = Number(range?.max);
    const minimum = Math.max(MIN_VIDEO_DURATION_SECONDS, Number.isFinite(Number(range?.min)) ? Math.ceil(Number(range?.min)) : MIN_VIDEO_DURATION_SECONDS);
    const options = [...(range?.options || [])].map(Number).filter((item) => Number.isInteger(item) && item >= minimum && (!Number.isFinite(rawMax) || item <= rawMax)).sort((left, right) => left - right);
    if (options.length) {
        const unique = [...new Set(options)];
        return unique.includes(requested) ? requested : unique[0];
    }
    const min = minimum;
    const max = Number.isFinite(rawMax) && rawMax >= min ? Math.floor(rawMax) : Math.max(min, 60);
    return Math.max(min, Math.min(max, Number.isFinite(requested) ? requested : min));
}

export type ChannelModel = {
    name: string;
    displayName?: string;
    capability: ModelCapability;
    icon?: string;
    iconUrl?: string;
    script?: string;
    videoCapabilities?: VideoModelCapabilities;
};

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    models: ChannelModel[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioVoiceName: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    videoMode: string;
    systemPrompt: string;
    models: string[];
    quality: string;
    size: string;
    count: string;
    canvasImageCount: string;
    videoParameters: Record<string, unknown>;
};

export type ConfigTabKey = "preferences";

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: OPENAI_BASE_URL,
    apiKey: "",
    apiFormat: "openai",
    channels: [
        {
            id: "default",
            name: "默认渠道",
            baseUrl: OPENAI_BASE_URL,
            apiKey: "",
            apiFormat: "openai",
            models: [
                { name: "gpt-image-2", capability: "image" },
                { name: "gpt-5.5", capability: "text" },
                { name: "gpt-4o-mini-tts", capability: "audio" },
            ],
        },
    ],
    model: "default::gpt-image-2",
    imageModel: "default::gpt-image-2",
    videoModel: "",
    textModel: "default::gpt-5.5",
    audioModel: "default::gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioVoiceName: "Alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    videoMode: "text2video",
    systemPrompt: "",
    models: ["default::gpt-image-2", "default::gpt-5.5", "default::gpt-4o-mini-tts"],
    quality: "auto",
    size: "1:1",
    count: "1",
    canvasImageCount: "3",
    videoParameters: {},
};

type ConfigStore = {
    config: AiConfig;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

const VIDEO_KEYWORDS = ["seedance", "video", "sora", "veo", "kling", "wan", "hailuo"];
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"];

/** Best-effort default capability for a freshly fetched model name; user can override in the channel editor. */
export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    return "text";
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.name === name);
    return channel && model ? { channel, model } : null;
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    return findChannelModel(config, value)?.model.capability;
}

export function videoCapabilitiesOf(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model.videoCapabilities;
}

export function modelIconOf(config: AiConfig, value: string) {
    const model = findChannelModel(config, value)?.model;
    return model ? { icon: model.icon, iconUrl: model.iconUrl, capability: model.capability } : undefined;
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    if (!capability) return true;
    return modelCapabilityOf(config, value) === capability;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config.channels.flatMap((channel) => channel.models.filter((model) => model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)));
}

/** The user script (if any) attached to a model; empty string means use the system default call. */
export function resolveModelScript(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model.script?.trim() || "";
}

function isAiConfigReady(config: AiConfig, model: string) {
    const channel = resolveModelChannel(config, model);
    return Boolean(model.trim() && channel.baseUrl.trim() && channel.apiKey.trim());
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            isConfigOpen: false,
            configTab: "preferences",
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false, configTab = "preferences") => set({ isConfigOpen: true, shouldPromptContinue, configTab }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            storage: createJSONStorage(() => ({
                getItem: (name) => localForageStorage.getItem(accountScopedKey(name)),
                setItem: (name, value) => localForageStorage.setItem(accountScopedKey(name), value),
                removeItem: (name) => localForageStorage.removeItem(accountScopedKey(name)),
            })),
            partialize: (state) => ({ config: state.config }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                if (!Array.isArray(persistedConfig.channels)) config.channels = [];
                const channels = normalizeChannels(config);
                const models = modelOptionsFromChannels(channels);
                return {
                    ...current,
                    config: {
                        ...config,
                        channelMode: "local",
                        apiFormat: normalizeApiFormat(config.apiFormat),
                        channels,
                        models,
                        imageModel: normalizeModelOptionValue(config.imageModel || config.model, channels),
                        videoModel: normalizeModelOptionValue(config.videoModel, channels),
                        textModel: normalizeModelOptionValue(config.textModel || config.model, channels),
                        audioModel: normalizeModelOptionValue(config.audioModel || defaultConfig.audioModel, channels),
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioVoiceName: config.audioVoiceName || "",
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        videoSeconds: String(normalizeVideoDuration(config.videoSeconds || "6")),
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        videoMode: config.videoMode || "text2video",
                        videoParameters: config.videoParameters && typeof config.videoParameters === "object" && !Array.isArray(config.videoParameters) ? config.videoParameters : {},
                        canvasImageCount: config.canvasImageCount || "3",
                    },
                };
            },
        },
    ),
);

export async function rehydrateConfigForAccount() {
    useConfigStore.setState({ config: defaultConfig });
    await useConfigStore.persist.rehydrate();
}

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

/** Normalize a mixed list of raw model names or model objects into deduped ChannelModel entries. */
export function normalizeChannelModels(models: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const item of models || []) {
        const name = (typeof item === "string" ? item : item?.name || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const capability = typeof item === "string" ? guessCapability(name) : item.capability || guessCapability(name);
        const displayName = typeof item === "string" ? undefined : item.displayName?.trim() || undefined;
        const icon = typeof item === "string" ? undefined : item.icon?.trim() || undefined;
        const iconUrl = typeof item === "string" ? undefined : item.iconUrl?.trim() || undefined;
        const script = typeof item === "string" ? undefined : item.script?.trim() || undefined;
        const videoCapabilities = typeof item === "string" ? undefined : item.videoCapabilities;
        result.push({ name, displayName, capability, icon, iconUrl, script, videoCapabilities });
    }
    return result;
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || "新渠道",
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        apiFormat,
        models: normalizeChannelModels(channel?.models),
    };
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    const model = channel?.models.find((item) => item.name === decoded.model);
    return model?.videoCapabilities?.displayName || model?.displayName || decoded.model;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel && channel.models.some((item) => item.name === decoded.model) ? model : "";
    }
    const channel = channels.find((item) => item.models.some((entry) => entry.name === model)) || channels[0];
    return channel && channel.models.some((item) => item.name === model) ? encodeChannelModel(channel.id, model) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.some((item) => item.name === model));
    return matched || config.channels[0] || createModelChannel({ id: "default", name: "默认渠道", baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName).map((name) => ({ name, capability: guessCapability(name) })) });
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
    };
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const channels = persistedChannels.map((channel, index) =>
        createModelChannel({
            ...channel,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
            name: channel.name || (index === 0 ? "默认渠道" : `渠道 ${index + 1}`),
            models: normalizeChannelModels(channel.models).filter((model) => !(
                model.name === "grok-imagine-video"
                && (channel.id || (index === 0 ? "default" : "")) === "default"
                && !String(channel.apiKey || "").trim()
                && String(channel.baseUrl || OPENAI_BASE_URL).replace(/\/+$/, "") === OPENAI_BASE_URL
            )),
        }),
    );
    if (!channels.length) {
        channels.push(
            createModelChannel({
                id: "default",
                name: "默认渠道",
                baseUrl: config.baseUrl || defaultConfig.baseUrl,
                apiKey: config.apiKey || "",
                apiFormat: config.apiFormat || defaultConfig.apiFormat,
                models: normalizeChannelModels([config.model, config.imageModel, config.videoModel, config.textModel, config.audioModel].map(modelOptionName)),
            }),
        );
    }
    return channels;
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    return apiFormat === "gemini" ? GEMINI_BASE_URL : OPENAI_BASE_URL;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" ? "gemini" : "openai";
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}
