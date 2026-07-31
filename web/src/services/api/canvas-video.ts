import axios from "axios";

import { getMediaBlob } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { buildApiUrl, modelOptionName, resolveModelRequestConfig, videoCapabilitiesOf, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type CanvasVideoTask = {
    id: string;
    status: "queued" | "in_progress" | "completed" | "failed";
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
    estimatedCostCredits?: number;
    chargedCredits?: number;
    balanceAfter?: number | null;
    billingStatus?: string;
    pricingVersion?: number;
    pricingSnapshot?: {
        routeLabel?: string;
        model?: string;
        quality?: string;
        billingType?: string;
        saleBaseCredits?: number;
        inputVideoMultiplier?: number;
    } | null;
    archiveStatus?: string | null;
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

export function isCanvasVideoModel(config: AiConfig, model = config.model || config.videoModel) {
    return videoCapabilitiesOf(config, model)?.provider === "canvas-video";
}

export async function createCanvasVideoTask(config: AiConfig, input: CreateInput, signal?: AbortSignal) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.videoModel);
    const capabilities = videoCapabilitiesOf(config, config.model || config.videoModel);
    if (!capabilities) throw new Error("视频模型能力配置已失效，请重新打开画布");

    const imageAssetIds = await uploadAssets(requestConfig, "image", input.referenceImages || [], signal);
    const videoAssetIds = await uploadAssets(requestConfig, "video", input.referenceVideos || [], signal);
    const audioAssetIds = await uploadAssets(requestConfig, "audio", input.referenceAudios || [], signal);
    const aspectRatio = capabilities.aspectRatios.includes(config.size) ? config.size : capabilities.aspectRatios[0];
    const quality = capabilities.qualities.some((item) => item.quality === config.vquality) ? config.vquality : capabilities.qualities[0]?.quality;
    const duration = normalizeDuration(config.videoSeconds, capabilities.duration);
    const selectedQuality = capabilities.qualities.find((item) => item.quality === quality) || capabilities.qualities[0];
    const multiplier = videoAssetIds.length ? Number(selectedQuality?.pricing.inputVideoMultiplier || 1) : 1;
    const basePrice = Number(selectedQuality?.pricing.credits || 0);
    const expectedCostCredits = Math.ceil((selectedQuality?.pricing.type === "per_second" ? basePrice * duration : basePrice) * multiplier);
    const pricingVersion = Number(selectedQuality?.pricingVersion || capabilities.pricingVersion || 0);
    let mode = capabilities.modes.includes(config.videoMode) ? config.videoMode : capabilities.modes[0];
    if (imageAssetIds.length && mode === "text2video" && capabilities.modes.includes("image2video")) mode = "image2video";
    if (!aspectRatio || !quality || !mode) throw new Error("视频模型能力配置不完整，请稍后重试");
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

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
            pricingVersion,
            expectedCostCredits,
        }, { headers: canvasVideoHeaders(requestConfig) });
        window.dispatchEvent(new CustomEvent("canvas-video-balance-changed"));
        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 409 && (error.response.data as any)?.code === "PRICE_CHANGED") {
            const payload = error.response.data as any;
            window.dispatchEvent(new CustomEvent("canvas-video-pricing-changed", { detail: payload }));
            throw new CanvasVideoApiError("PRICE_CHANGED", `视频价格已更新为 ${payload.estimatedCostCredits} 积分，请刷新模型价格后重新确认生成`, payload);
        }
        if (axios.isAxiosError(error) && (error.response?.data as any)?.code === "VIDEO_CREDIT_INSUFFICIENT") {
            const payload = error.response?.data as any;
            window.dispatchEvent(new CustomEvent("canvas-video-recharge-required", { detail: payload }));
            throw new CanvasVideoApiError("VIDEO_CREDIT_INSUFFICIENT", `视频积分不足，当前 ${payload.balance || 0}，本次需要 ${payload.requiredCredits || expectedCostCredits} 积分`, payload);
        }
        throw new Error(readCanvasVideoError(error, "视频任务创建失败"));
    }
}

export async function getCanvasVideoTask(config: AiConfig, taskId: string, signal?: AbortSignal) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.videoModel);
    try {
        return (await axios.get<CanvasVideoTask>(canvasVideoUrl(requestConfig, `/tasks/${encodeURIComponent(taskId)}`), {
            headers: canvasVideoHeaders(requestConfig),
            signal,
        })).data;
    } catch (error) {
        throw new Error(readCanvasVideoError(error, "视频任务查询失败"));
    }
}

export async function waitForCanvasVideoTask(
    config: AiConfig,
    taskId: string,
    signal?: AbortSignal,
    onProgress?: (task: CanvasVideoTask) => void,
) {
    for (let attempt = 0; attempt < 360; attempt += 1) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const task = await getCanvasVideoTask(config, taskId, signal);
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
    throw new Error("视频生成仍在后台进行，稍后重新进入画布可继续查看");
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

function normalizeDuration(value: string, range: { min?: number | null; max?: number | null; options?: number[] | null }) {
    const requested = Math.floor(Number(value));
    const options = range.options || [];
    if (options.length) return options.includes(requested) ? requested : options[0];
    const min = range.min ?? 1;
    const max = range.max ?? Math.max(min, 60);
    return Math.max(min, Math.min(max, Number.isFinite(requested) ? requested : min));
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
