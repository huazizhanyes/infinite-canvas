import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { App, Button, Result, Spin } from "antd";

import { createModelChannel, encodeChannelModel, modelOptionsFromChannels, useConfigStore } from "@/stores/use-config-store";
import { initializeSucaiCanvasSync } from "@/services/sucai-canvas-sync";
import { useUserStore } from "@/stores/use-user-store";

const SUCAI_MODE_KEY = "infinite-canvas:sucai-mode";
const SUCAI_TOKEN_KEY = "sucai_token";
const SUCAI_CHANNEL_ID = "sucai-canvas";
const SUCAI_API_BASE = import.meta.env.VITE_SUCAI_CANVAS_API_BASE || "";
const SUCAI_BACKEND_BASE = import.meta.env.VITE_SUCAI_API_BASE || SUCAI_API_BASE.replace(/\/canvas\/?$/, "");
const SUCAI_HOME_URL = import.meta.env.VITE_SUCAI_HOME_URL || "/";

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
        handledSucaiInit.current = true;
        setSucaiState("loading");
        searchParams.delete("sucai");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);

        const token = localStorage.getItem(SUCAI_TOKEN_KEY) || "";
        if (!token) {
            setSucaiError("请先返回素材网完成登录");
            setSucaiState("error");
            return;
        }

        void fetch(`${SUCAI_API_BASE}/v1/models`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(async (response) => {
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(payload?.message || payload?.error?.message || "读取画布配置失败");
                const models = Array.isArray(payload?.data) ? payload.data : [];
                const imageModel = models.find((item: { capability?: string }) => item.capability === "image") || models[0];
                const textModels = models.filter((item: { capability?: string }) => item.capability === "text");
                const audioModels = models.filter((item: { capability?: string }) => item.capability === "audio");
                const textModel = textModels.find((item: { is_default?: boolean }) => item.is_default) || textModels[0];
                const audioModel = audioModels.find((item: { is_default?: boolean }) => item.is_default) || audioModels[0];
                if (!imageModel?.id) throw new Error("管理员尚未配置画布生图模型");
                const channel = createModelChannel({
                    id: SUCAI_CHANNEL_ID,
                    name: "闪帧 AI 画布",
                    baseUrl: SUCAI_API_BASE,
                    apiKey: token,
                    apiFormat: "openai",
                    models: models
                        .filter((item: { id?: string; capability?: string }) => item.id && ["image", "text", "audio"].includes(item.capability || ""))
                        .map((item: { id: string; capability: "image" | "text" | "audio" }) => ({ name: item.id, capability: item.capability })),
                });
                const imageModelValue = encodeChannelModel(channel.id, imageModel.id);
                const textModelValue = textModel?.id ? encodeChannelModel(channel.id, textModel.id) : "";
                const audioModelValue = audioModel?.id ? encodeChannelModel(channel.id, audioModel.id) : "";
                updateConfig("channels", [channel]);
                updateConfig("models", modelOptionsFromChannels([channel]));
                updateConfig("baseUrl", channel.baseUrl);
                updateConfig("apiKey", token);
                updateConfig("apiFormat", "openai");
                updateConfig("model", imageModelValue);
                updateConfig("imageModel", imageModelValue);
                if (textModelValue) updateConfig("textModel", textModelValue);
                if (audioModelValue) {
                    updateConfig("audioModel", audioModelValue);
                    updateConfig("audioFormat", "wav");
                    updateConfig("audioVoice", "");
                    updateConfig("audioVoiceName", "");
                }
                setConfigDialogOpen(false);
                useUserStore.getState().configure({ canvasBaseUrl: SUCAI_API_BASE, apiBaseUrl: SUCAI_BACKEND_BASE, token });
                void useUserStore.getState().loadAssets();
                await initializeSucaiCanvasSync({ baseUrl: SUCAI_API_BASE, token }).catch((error) => {
                    console.warn("[SucaiCanvasSync] initialization failed", error);
                });
                setSucaiState("ready");
            })
            .catch((error) => {
                setSucaiError(error instanceof Error ? error.message : "画布初始化失败");
                setSucaiState("error");
            });
    }, [setConfigDialogOpen, updateConfig]);

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
