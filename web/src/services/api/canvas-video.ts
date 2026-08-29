import axios from "axios";

import { getMediaBlob } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { buildApiUrl, modelOptionName, normalizeVideoDuration, resolveModelRequestConfig, videoCapabilitiesOf, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type CanvasVideoTask = {
    id: string;
    clientRequestId?: string;
    status: "queued" | "in_progress" | "submission_unknown" | "completed" | "failed";
    progress: number;
    projectId: string;
    nodeId: string;
    modelId: string;
    mode: string;
    aspectRatio: string;
    quality: string;
    duration: number;
    resultUrl?: string | null;
    serverStorageKey?: string | null;
    storageType?: "local" | "oss" | null;
    mimeType?: string | null;
    width?: number | null;
    height?: number | null;
    error?: { code?: string | null; message?: string | null } | null;
    upstreamRetryCount?: number;
    statusMessage?: string | null;
    estimatedCostCredits?: number;
    chargedCredits?: number;
    balanceAfter?: number | null;
    billingStatus?: string;
    pricingVersion?: number;
    parameters?: Record<string, unknown>;
    capabilitySnapshot?: Record<string, unknown> | null;
    pricingSnapshot?: {
        routeLabel?: string;
        model?: string;
        quality?: string;
        billingType?: string;
        saleBaseCredits?: number;
        inputVideoMultiplier?: number;
    } | null;
    archiveStatus?: string | null;
    canCancel?: boolean;
    queuePosition?: number | null;
    internalStatus?: string;
};

export type CanvasVideoTaskEvent = {
    id: string;
    eventSeq: number;
    taskId: string;
    traceId: string;
    eventType: string;
    stage: string;
    attemptNo: number;
    durationMs?: number | null;
    httpStatus?: number | null;
    providerRequestId?: string | null;
    upstreamTaskId?: string | null;
    status?: string | null;
    billingStatus?: string | null;
    amountMicros?: string | null;
    balanceAfterMicros?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    metadata?: Record<string, unknown> | null;
    createdAt: string;
};

export type CanvasVideoStoredResult = {
    url: string;
    storageKey: string;
    bytes: number;
    mimeType: string;
    width?: number;
    height?: number;
    durationMs?: number;
    estimatedCostCredits?: number;
    chargedCredits?: number;
    balanceAfter?: number | null;
    billingStatus?: string;
    pricingVersion?: number;
    routeLabel?: string;
};

type CreateInput = {
    projectId: string;
    nodeId: string;
    clientRequestId: string;
    prompt: string;
    referenceImages?: ReferenceImage[];
    referenceVideos?: ReferenceVideo[];
    referenceAudios?: ReferenceAudio[];
};
import { canvasBillingApi } from "./canvas-billing";
import { useUserStore } from "@/stores/use-user-store";

export function isCanvasVideoModel(config: AiConfig, model = config.model || config.videoModel) {
    return videoCapabilitiesOf(config, model)?.provider === "canvas-video";
}

export async function createCanvasVideoTask(config: AiConfig, input: CreateInput, signal?: AbortSignal) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.videoModel);
    const capabilities = videoCapabilitiesOf(config, config.model || config.videoModel);
    if (!capabilities) throw new Error("视频模型能力配置已失效，请重新打开画布");

    const referenceImages = input.referenceImages || [];
    const referenceVideos = input.referenceVideos || [];
    const referenceAudios = input.referenceAudios || [];
    if (referenceImages.length > capabilities.inputImagesMax) throw new Error(`参考图片最多 ${capabilities.inputImagesMax} 张`);
    if (referenceVideos.length > capabilities.inputVideosMax) throw new Error(`参考视频最多 ${capabilities.inputVideosMax} 个`);
    if (referenceAudios.length > capabilities.inputAudiosMax) throw new Error(`参考音频最多 ${capabilities.inputAudiosMax} 个`);

    let mode = capabilities.modes.includes(config.videoMode) ? config.videoMode : capabilities.modes[0];
    const modeRule = capabilities.modeRules?.find((rule) => rule.mode === mode);
    assertReferenceCount(referenceImages.length, modeRule?.inputImagesMin, modeRule?.inputImagesMax, "参考图片");
    assertReferenceCount(referenceVideos.length, modeRule?.inputVideosMin, modeRule?.inputVideosMax, "参考视频");
    assertReferenceCount(referenceAudios.length, modeRule?.inputAudiosMin, modeRule?.inputAudiosMax, "参考音频");

    const imageAssetIds = await uploadAssets(requestConfig, "image", referenceImages, signal);
    const videoAssetIds = await uploadAssets(requestConfig, "video", referenceVideos, signal);
    const audioAssetIds = await uploadAssets(requestConfig, "audio", referenceAudios, signal);
    if (typeof window !== "undefined" && window.localStorage.getItem("canvas.debug.references") === "1") {
        console.log("[Canvas] uploaded asset order", {
            imageSourceIds: referenceImages.map((reference) => reference.id),
            imageAssetIds,
            videoSourceIds: referenceVideos.map((reference) => reference.id),
            videoAssetIds,
            audioSourceIds: referenceAudios.map((reference) => reference.id),
            audioAssetIds,
        });
    }
    const aspectRatio = capabilities.aspectRatios.includes(config.size) ? config.size : capabilities.aspectRatios[0];
    const quality = capabilities.qualities.some((item) => item.quality === config.vquality) ? config.vquality : capabilities.qualities[0]?.quality;
    const duration = normalizeVideoDuration(config.videoSeconds, capabilities.duration);
    const selectedQuality = capabilities.qualities.find((item) => item.quality === quality) || capabilities.qualities[0];
    const pricingVersion = Number(selectedQuality?.pricingVersion || capabilities.pricingVersion || 0);
    if (!aspectRatio || !quality || !mode) throw new Error("视频模型能力配置不完整，请稍后重试");
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const connection = useUserStore.getState().connection;
    if (!connection) throw new Error("请先登录后生成视频");
    const quotePayload = {
        feature: "canvas.video.generate", requestId: input.clientRequestId,
        modelId: modelOptionName(config.model || config.videoModel), prompt: input.prompt,
        aspectRatio, quality, duration, mode, imageAssetIds, videoAssetIds, audioAssetIds,
        parameters: config.videoParameters || {},
    };
    const quote = await canvasBillingApi.quote(connection, quotePayload, signal);

    try {
        const response = await axios.post<CanvasVideoTask>(canvasVideoUrl(requestConfig, "/tasks"), {
            clientRequestId: input.clientRequestId,
            projectId: input.projectId,
            nodeId: input.nodeId,
            modelId: modelOptionName(config.model || config.videoModel),
            prompt: input.prompt,
            aspectRatio,
            quality,
            duration,
            mode,
            imageAssetIds,
            videoAssetIds,
            audioAssetIds,
            parameters: config.videoParameters || {},
            pricingVersion,
            quoteToken: quote.quoteToken,
        }, { headers: canvasVideoHeaders(requestConfig) });
        window.dispatchEvent(new CustomEvent("canvas-video-balance-changed"));
        return response.data;
    } catch (error) {
        if (isRequestTimeout(error)) {
            const recovered = await listCanvasVideoTasks(config, { clientRequestId: input.clientRequestId }, signal).catch(() => null);
            const task = recovered?.find((item) => item.clientRequestId === input.clientRequestId);
            if (task) return task;
        }
        if (axios.isAxiosError(error) && error.response?.status === 409 && (error.response.data as any)?.code === "PRICE_CHANGED") {
            const payload = error.response.data as any;
            window.dispatchEvent(new CustomEvent("canvas-video-pricing-changed", { detail: payload }));
            throw new CanvasVideoApiError("PRICE_CHANGED", "视频价格已更新，请重新确认人民币报价", payload);
        }
        if (axios.isAxiosError(error) && ["VIDEO_CREDIT_INSUFFICIENT", "WALLET_INSUFFICIENT"].includes((error.response?.data as any)?.code)) {
            const payload = error.response?.data as any;
            window.dispatchEvent(new CustomEvent("canvas-video-recharge-required", { detail: payload }));
            throw new CanvasVideoApiError("WALLET_INSUFFICIENT", "AI 钱包余额不足，请充值后重试", payload);
        }
        throw new Error(readCanvasVideoError(error, "视频任务创建失败"));
    }
}

export async function listCanvasVideoTasks(config: AiConfig, params: Record<string, unknown> = {}, signal?: AbortSignal) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.videoModel);
    const response = await axios.get<{ object: "list"; data: CanvasVideoTask[] }>(canvasVideoUrl(requestConfig, "/tasks"), {
        headers: canvasVideoHeaders(requestConfig), params, signal,
    });
    return response.data.data || [];
}

export async function getCanvasVideoTask(config: AiConfig, taskId: string, signal?: AbortSignal) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.videoModel);
    try {
        return (await axios.get<CanvasVideoTask>(canvasVideoUrl(requestConfig, `/tasks/${encodeURIComponent(taskId)}`), {
            headers: canvasVideoHeaders(requestConfig),
            signal,
        })).data;
    } catch (error) {
        if (signal?.aborted) throw error;
        if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            const retryable = !status || status === 408 || status === 429 || status >= 500 || error.code === "ECONNABORTED" || error.code === "ETIMEDOUT";
            if (retryable) throw new CanvasVideoApiError("POLL_RETRYABLE", readCanvasVideoError(error, "视频任务查询暂时不可用"), { status });
        }
        throw new Error(readCanvasVideoError(error, "视频任务查询失败"));
    }
}

export async function getCanvasVideoTaskEvents(config: AiConfig, taskId: string, signal?: AbortSignal) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.videoModel);
    const response = await axios.get<{ object: "list"; data: CanvasVideoTaskEvent[] }>(canvasVideoUrl(requestConfig, `/tasks/${encodeURIComponent(taskId)}/events`), {
        headers: canvasVideoHeaders(requestConfig), signal,
    });
    return response.data.data || [];
}

export async function listCanvasVideoBillingLedger(config: AiConfig, params: { page?: number; limit?: number; taskId?: string } = {}, signal?: AbortSignal) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.videoModel);
    const response = await axios.get(canvasVideoUrl(requestConfig, "/billing/ledger"), { headers: canvasVideoHeaders(requestConfig), params, signal });
    return response.data as { total: number; page: number; limit: number; summary: { availableMicros: string; reservedMicros: string; totalSpentMicros: string }; list: Array<Record<string, unknown>> };
}

export async function getCanvasVideoConcurrency(config: AiConfig, signal?: AbortSignal) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.videoModel);
    const response = await axios.get<{ tier: "NORMAL" | "SILVER" | "GOLD" | "DIAMOND"; concurrentLimit: number; currentExecuting: number; queueLimit: number; currentQueued: number; routeLimit: number }>(canvasVideoUrl(requestConfig, "/concurrency"), { headers: canvasVideoHeaders(requestConfig), signal });
    return response.data;
}

export async function cancelQueuedCanvasVideoTask(config: AiConfig, taskId: string) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.videoModel);
    const response = await axios.post<CanvasVideoTask>(canvasVideoUrl(requestConfig, `/tasks/${encodeURIComponent(taskId)}/cancel`), {}, { headers: canvasVideoHeaders(requestConfig) });
    window.dispatchEvent(new CustomEvent("canvas-video-balance-changed"));
    return response.data;
}

export async function waitForCanvasVideoTask(
    config: AiConfig,
    taskId: string,
    signal?: AbortSignal,
    onProgress?: (task: CanvasVideoTask) => void,
) {
    let retryDelayMs = 10_000;
    for (let attempt = 0; ; attempt += 1) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        let task: CanvasVideoTask;
        try {
            task = await getCanvasVideoTask(config, taskId, signal);
            retryDelayMs = 10_000;
        } catch (error) {
            if (signal?.aborted) throw error;
            if (error instanceof CanvasVideoApiError && error.code === "POLL_RETRYABLE") {
                await delay(retryDelayMs, signal);
                retryDelayMs = Math.min(30_000, retryDelayMs * 2);
                continue;
            }
            throw error;
        }
        onProgress?.(task);
        if (task.status === "completed") {
            window.dispatchEvent(new CustomEvent("canvas-video-balance-changed"));
            return canvasVideoResult(task);
        }
        if (task.status === "failed") {
            window.dispatchEvent(new CustomEvent("canvas-video-balance-changed"));
            throw new Error(task.error?.message || "视频生成失败");
        }
        await delay(10_000, signal);
    }
}

export function canvasVideoResult(task: CanvasVideoTask): CanvasVideoStoredResult {
    if (!task.resultUrl) throw new Error("视频任务已完成但没有可播放地址");
    return {
        url: task.resultUrl,
        storageKey: task.serverStorageKey || "",
        bytes: 0,
        mimeType: task.mimeType || "video/mp4",
        width: task.width || undefined,
        height: task.height || undefined,
        durationMs: Number.isFinite(Number(task.duration)) ? Number(task.duration) * 1000 : undefined,
        estimatedCostCredits: task.estimatedCostCredits,
        chargedCredits: task.chargedCredits,
        balanceAfter: task.balanceAfter,
        billingStatus: task.billingStatus,
        pricingVersion: task.pricingVersion,
        routeLabel: task.pricingSnapshot?.routeLabel,
    };
}

export class CanvasVideoApiError extends Error {
    constructor(public readonly code: string, message: string, public readonly details?: Record<string, unknown>) {
        super(message);
        this.name = "CanvasVideoApiError";
    }
}

async function uploadAssets(
    config: AiConfig,
    kind: "image" | "video" | "audio",
    references: Array<ReferenceImage | ReferenceVideo | ReferenceAudio>,
    signal?: AbortSignal,
) {
    const ids: string[] = [];
    for (const reference of references) {
        const file = await referenceFile(reference, kind);
        const form = new FormData();
        form.append("kind", kind);
        form.append("file", file);
        try {
            const response = await axios.post<{ assetId: string }>(canvasVideoUrl(config, "/assets"), form, {
                headers: canvasVideoHeaders(config),
                signal,
            });
            if (!response.data.assetId) throw new Error("素材上传接口未返回 assetId");
            ids.push(response.data.assetId);
        } catch (error) {
            throw new Error(readCanvasVideoError(error, `${kindLabel(kind)}上传失败`));
        }
    }
    return ids;
}

async function referenceFile(reference: ReferenceImage | ReferenceVideo | ReferenceAudio, kind: "image" | "video" | "audio") {
    let blob: Blob | null = null;
    if (kind === "image") {
        const image = reference as ReferenceImage;
        const url = await imageToDataUrl(image);
        if (url) blob = await fetch(url).then((response) => response.blob());
    } else {
        const media = reference as ReferenceVideo | ReferenceAudio;
        if (media.storageKey) blob = await getMediaBlob(media.storageKey);
        if (!blob && media.url) blob = await fetch(media.url).then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.blob();
        });
    }
    if (!blob?.size) throw new Error(`${kindLabel(kind)}读取失败，请重新上传后重试`);
    const fallbackType = kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg";
    return new File([blob], reference.name || `reference.${extensionForMime(blob.type || fallbackType)}`, { type: blob.type || fallbackType });
}

function assertReferenceCount(value: number, min: number | undefined, max: number | undefined, label: string) {
    if (min != null && value < min) throw new Error(`${label}至少需要 ${min} 个`);
    if (max != null && value > max) throw new Error(`${label}最多 ${max} 个`);
}

function canvasVideoUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, `/video${path}`);
}

function canvasVideoHeaders(config: AiConfig) {
    return { Authorization: `Bearer ${config.apiKey}` };
}

function readCanvasVideoError(error: unknown, fallback: string) {
    if (axios.isCancel(error) || (error instanceof Error && error.name === "CanceledError")) return "请求已取消";
    if (axios.isAxiosError(error)) {
        const payload = error.response?.data as any;
        const message = payload?.message || payload?.error?.message || payload?.msg;
        if (Array.isArray(message)) return message.join("；");
        if (message) return String(message);
    }
    return error instanceof Error && error.message ? error.message : fallback;
}

function isRequestTimeout(error: unknown) {
    return axios.isAxiosError(error) && (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT" || String(error.message || "").toLowerCase().includes("timeout"));
}

function kindLabel(kind: "image" | "video" | "audio") {
    return kind === "image" ? "参考图片" : kind === "video" ? "参考视频" : "参考音频";
}

function extensionForMime(mime: string) {
    const subtype = mime.split("/")[1]?.split(";")[0] || "bin";
    return subtype === "jpeg" ? "jpg" : subtype;
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
    });
}
