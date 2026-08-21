import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { App, Button, Result, Spin } from "antd";

import { createModelChannel, encodeChannelModel, modelOptionsFromChannels, useConfigStore, rehydrateConfigForAccount } from "@/stores/use-config-store";
import { initializeSucaiCanvasSync } from "@/services/sucai-canvas-sync";
import { stopSucaiCanvasSync } from "@/services/sucai-canvas-sync";
import { useUserStore } from "@/stores/use-user-store";
import { setCanvasAccountScope, migrateLegacyCanvasData, clearCanvasAccountScope } from "@/lib/canvas-account-scope";
import { rehydrateCanvasStoreForAccount, clearCanvasStoreMemory } from "@/stores/canvas/use-canvas-store";
import { rehydrateAssetStoreForAccount, clearAssetStoreMemory } from "@/stores/use-asset-store";
import { rehydrateCanvasHostTaskStoreForAccount, clearCanvasHostTaskStoreMemory } from "@/stores/canvas/use-canvas-host-task-store";

const SUCAI_MODE_KEY = "infinite-canvas:sucai-mode";
const SUCAI_TOKEN_KEY = "sucai_token";
const SUCAI_CHANNEL_ID = "sucai-canvas";
const SUCAI_API_BASE = import.meta.env.VITE_SUCAI_CANVAS_API_BASE || "";
const SUCAI_BACKEND_BASE = import.meta.env.VITE_SUCAI_API_BASE || SUCAI_API_BASE.replace(/\/canvas\/?$/, "");
const SUCAI_HOME_URL = import.meta.env.VITE_SUCAI_HOME_URL || "/";
const SUCAI_DEV_PORT = import.meta.env.VITE_SUCAI_DEV_PORT || "";

type SucaiInitState = "idle" | "loading" | "ready" | "error";

function isSucaiModeRequested() {
    const searchParams = new URLSearchParams(window.location.search);
    return import.meta.env.VITE_SUCAI_INTEGRATION === "true" || searchParams.get("sucai") === "1" || sessionStorage.getItem(SUCAI_MODE_KEY) === "1";
}

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const handledSucaiInit = useRef(false);
    const [sucaiState, setSucaiState] = useState<SucaiInitState>(() => (isSucaiModeRequested() ? "loading" : "idle"));
    const [sucaiError, setSucaiError] = useState("");
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);

    useEffect(() => {
        if (handledSucaiInit.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const transferredToken = fragment.get("sucai_token") || "";
        if (transferredToken) {
            localStorage.setItem(SUCAI_TOKEN_KEY, transferredToken);
            fragment.delete("sucai_token");
            window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${fragment.size ? `#${fragment}` : ""}`);
        }
        if (searchParams.get("sucai") === "1") sessionStorage.setItem(SUCAI_MODE_KEY, "1");
        const sucaiMode = isSucaiModeRequested();
        if (!sucaiMode) return;
        if (import.meta.env.DEV && SUCAI_DEV_PORT && window.location.port !== SUCAI_DEV_PORT) {
            const entry = new URL(`/canvas/${window.location.search}${window.location.hash}`, `${window.location.protocol}//${window.location.hostname}:${SUCAI_DEV_PORT}`);
            window.location.replace(entry.toString());
            return;
        }
        handledSucaiInit.current = true;
        setSucaiState("loading");
        searchParams.delete("sucai");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);

        const token = localStorage.getItem(SUCAI_TOKEN_KEY) || "";
        if (!token) {
            setSucaiState("ready");
            return;
        }

        const requestModels = async (path: string, optional = false) => {
            const response = await fetch(`${SUCAI_API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                if (optional) return [];
                throw new Error(payload?.message || payload?.error?.message || "读取画布配置失败");
            }
            return Array.isArray(payload?.data) ? payload.data : [];
        };
        const mapVideoModel = (item: any) => ({
            name: item.id,
            capability: "video" as const,
            videoCapabilities: {
                provider: "canvas-video" as const,
                displayName: item.display_name || item.id,
                channel: item.channel,
                routeLabel: item.routeLabel || item.channel_title || item.channel,
                upstreamModel: item.upstream_model,
                pricingVersion: Number(item.pricingVersion || 0),
                qualities: Array.isArray(item.qualities) ? item.qualities : [],
                aspectRatios: Array.isArray(item.aspect_ratios) ? item.aspect_ratios : [],
                duration: item.duration || {},
                modes: Array.isArray(item.modes) ? item.modes : [],
                inputImagesMax: Number(item.input_images_max || 0),
                inputVideosMax: Number(item.input_videos_max || 0),
                inputAudiosMax: Number(item.input_audios_max || 0),
                parameters: Array.isArray(item.parameters || item.parameter_schema) ? (item.parameters || item.parameter_schema) : [],
                modeRules: Array.isArray(item.modeRules || item.mode_rules) ? (item.modeRules || item.mode_rules) : [],
                faceFriendly: Boolean(item.faceFriendly || item.face_friendly || item.channel === "59" && item.upstream_model === "minimax-h3"),
                displayNotice: item.displayNotice || item.display_notice || "不卡人脸；不代表换脸、口型驱动或强身份一致性。",
            },
        });
        const refreshVideoPricing = () => {
            void requestModels("/v1/video/models", true).then((videoModels) => {
                const current = useConfigStore.getState().config;
                const channels = current.channels.map((channel) => channel.id === SUCAI_CHANNEL_ID
                    ? createModelChannel({ ...channel, models: [...channel.models.filter((item) => item.capability !== "video"), ...videoModels.map(mapVideoModel)] })
                    : channel);
                const selectedExists = channels.some((channel) => channel.models.some((item) => encodeChannelModel(channel.id, item.name) === current.videoModel));
                const nextDefault = videoModels.find((item: { default_option?: boolean }) => item.default_option) || videoModels[0];
                updateConfig("channels", channels);
                updateConfig("models", modelOptionsFromChannels(channels));
                if (!selectedExists && nextDefault?.id) updateConfig("videoModel", encodeChannelModel(SUCAI_CHANNEL_ID, nextDefault.id));
            }).catch(() => undefined);
        };
        window.addEventListener("canvas-video-pricing-changed", refreshVideoPricing);

        void Promise.all([requestModels("/v1/models"), requestModels("/v1/video/models", true).catch(() => [])])
            .then(async ([models, videoModels]) => {
                await transitionCanvasAccount(token);
                const imageModel = models.find((item: { capability?: string }) => item.capability === "image") || models[0];
                const textModels = models.filter((item: { capability?: string }) => item.capability === "text");
                const audioModels = models.filter((item: { capability?: string }) => item.capability === "audio");
                const textModel = textModels.find((item: { is_default?: boolean }) => item.is_default) || textModels[0];
                const audioModel = audioModels.find((item: { is_default?: boolean }) => item.is_default) || audioModels[0];
                const videoModel = videoModels.find((item: { default_option?: boolean }) => item.default_option) || videoModels[0];
                if (!imageModel?.id) throw new Error("管理员尚未配置画布生图模型");
                const channel = createModelChannel({
                    id: SUCAI_CHANNEL_ID,
                    name: "闪帧 AI 画布",
                    baseUrl: SUCAI_API_BASE,
                    apiKey: token,
                    apiFormat: "openai",
                    models: [
                        ...models
                            .filter((item: { id?: string; capability?: string }) => item.id && ["image", "text", "audio"].includes(item.capability || ""))
                            .map((item: { id: string; display_name?: string; capability: "image" | "text" | "audio" }) => ({ name: item.id, displayName: item.display_name || item.id, capability: item.capability })),
                        ...videoModels.map(mapVideoModel),
                    ],
                });
                const imageModelValue = encodeChannelModel(channel.id, imageModel.id);
                const textModelValue = textModel?.id ? encodeChannelModel(channel.id, textModel.id) : "";
                const audioModelValue = audioModel?.id ? encodeChannelModel(channel.id, audioModel.id) : "";
                const videoModelValue = videoModel?.id ? encodeChannelModel(channel.id, videoModel.id) : "";
                updateConfig("channels", [channel]);
                updateConfig("models", modelOptionsFromChannels([channel]));
                updateConfig("baseUrl", channel.baseUrl);
                updateConfig("apiKey", token);
                updateConfig("apiFormat", "openai");
                updateConfig("model", imageModelValue);
                updateConfig("imageModel", imageModelValue);
                if (textModelValue) updateConfig("textModel", textModelValue);
                if (videoModelValue) {
                    updateConfig("videoModel", videoModelValue);
                    updateConfig("videoMode", videoModel.modes?.[0] || "text2video");
                    updateConfig("size", videoModel.aspect_ratios?.[0] || "16:9");
                    updateConfig("vquality", videoModel.qualities?.[0]?.quality || "720p");
                    updateConfig("videoSeconds", String(videoModel.duration?.options?.[0] || videoModel.duration?.min || 5));
                    updateConfig("videoParameters", Object.fromEntries((videoModel.parameters || []).map((parameter: any) => [parameter.key, parameter.defaultValue] as [string, unknown]).filter(([, value]: [string, unknown]) => value !== undefined)));
                }
                if (audioModelValue) {
                    updateConfig("audioModel", audioModelValue);
                    updateConfig("audioFormat", "wav");
                    updateConfig("audioVoice", "");
                    updateConfig("audioVoiceName", "");
                }
                setConfigDialogOpen(false);
                const scope = setCanvasAccountScope(useUserStore.getState().user?.id || null);
                await initializeSucaiCanvasSync({ baseUrl: SUCAI_API_BASE, token, userId: scope?.userId, sessionEpoch: scope?.sessionEpoch }).catch((error) => {
                    console.warn("[SucaiCanvasSync] initialization failed", error);
                });
                setSucaiState("ready");
            })
            .catch((error) => {
                setSucaiError(error instanceof Error ? error.message : "画布初始化失败");
                setSucaiState("error");
            });
        return () => window.removeEventListener("canvas-video-pricing-changed", refreshVideoPricing);
    }, [setConfigDialogOpen, updateConfig]);

    useEffect(() => {
        if (!isSucaiModeRequested()) return;
        let handling = false;
        const checkAccountTransition = () => {
            const nextToken = localStorage.getItem(SUCAI_TOKEN_KEY) || "";
            const currentToken = useUserStore.getState().connection?.token || "";
            if (nextToken === currentToken || handling) return;
            handling = true;
            setSucaiState("loading");
            void stopSucaiCanvasSync().catch(() => undefined).finally(() => {
                clearCanvasStoreMemory();
                clearAssetStoreMemory();
                clearCanvasHostTaskStoreMemory();
                clearCanvasAccountScope();
                window.location.reload();
            });
        };
        const timer = window.setInterval(checkAccountTransition, 1000);
        window.addEventListener("storage", checkAccountTransition);
        window.addEventListener("canvas-account-changed", checkAccountTransition);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("storage", checkAccountTransition);
            window.removeEventListener("canvas-account-changed", checkAccountTransition);
        };
    }, []);

    async function transitionCanvasAccount(nextToken: string) {
        const currentToken = useUserStore.getState().connection?.token;
        if (currentToken && currentToken !== nextToken) {
            await stopSucaiCanvasSync().catch(() => undefined);
            clearCanvasStoreMemory();
            clearAssetStoreMemory();
            clearCanvasHostTaskStoreMemory();
            clearCanvasAccountScope();
            useUserStore.getState().clearSession();
        }
        useUserStore.getState().configure({ canvasBaseUrl: SUCAI_API_BASE, apiBaseUrl: SUCAI_BACKEND_BASE, token: nextToken });
        await useUserStore.getState().loadAssets();
        const userId = useUserStore.getState().user?.id;
        if (!userId) throw new Error("无法确认当前账号");
        setCanvasAccountScope(userId);
        const migratedLegacyData = await migrateLegacyCanvasData(userId);
        if (migratedLegacyData) message.warning("检测到旧版未分账号的画布数据，已归属到本次首次登录账号");
        await Promise.all([rehydrateCanvasStoreForAccount(), rehydrateAssetStoreForAccount(), rehydrateCanvasHostTaskStoreForAccount(), rehydrateConfigForAccount()]);
    }

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...(baseUrl ? { baseUrl } : {}),
                                ...(apiKey ? { apiKey } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: "默认渠道", baseUrl: baseUrl || undefined, apiKey: apiKey || "" })],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
        message.success("已导入本地直连配置");
    }, [config.channels, message, openConfigDialog, updateConfig]);

    if (sucaiState === "loading") {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <Spin size="large" />
            </div>
        );
    }
    if (sucaiState === "error") {
        return (
            <div className="flex min-h-screen items-center justify-center bg-white dark:bg-neutral-950">
                <Result
                    status="403"
                    title="暂时无法进入 AI 画布"
                    subTitle={sucaiError}
                    extra={
                        <Button type="primary" onClick={() => window.location.assign(SUCAI_HOME_URL)}>
                            返回素材网
                        </Button>
                    }
                />
            </div>
        );
    }
    return <>{children}</>;
}
