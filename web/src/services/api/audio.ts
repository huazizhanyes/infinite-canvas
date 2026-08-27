import axios from "axios";

import { audioMimeType, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { getMediaBlob } from "@/services/file-storage";
import { uploadCanvasMedia } from "@/services/canvas-media";
import { buildApiUrl, decodeChannelModel, resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";
import { canvasBillingApi } from "./canvas-billing";
import { nanoid } from "nanoid";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceAudio } from "@/types/media";

type RequestOptions = {
    signal?: AbortSignal;
    referenceAudio?: ReferenceAudio;
    onTaskCreated?: (task: { taskId: string; engine: "speech" | "voxcpm2"; voiceId?: number; characterCount: number }) => void;
};

export type CanvasAudioVoice = {
    id: number;
    name: string;
    displayName: string;
    gender?: string;
    age_group?: string;
    language_type?: string;
    style?: string;
    description?: string;
    avatar?: string;
    preview_url: string;
    source: string;
    is_private: boolean;
    isFavorite: boolean;
    favoriteCategoryIds: number[];
};

export type CanvasVoiceFavoriteCategory = { id: number; name: string; isDefault: boolean; count: number };
export type CanvasAudioVoiceList = { voices: CanvasAudioVoice[]; favoriteCategories: CanvasVoiceFavoriteCategory[]; favoriteCount: number };

export type GeneratedAudioResult = {
    blob?: Blob;
    stableUrl?: string;
    taskId?: string;
    engine?: "speech" | "voxcpm2";
    voiceId?: number;
    format?: string;
    characterCount?: number;
    mimeType?: string;
};

export type StoredGeneratedAudio = UploadedFile & Omit<GeneratedAudioResult, "blob" | "stableUrl">;

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
    };
}

export async function requestAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<GeneratedAudioResult> {
    const selectedModel = config.model || config.audioModel;
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const model = requestConfig.model.trim();
    const format = normalizeAudioFormatValue(config.audioFormat);
    if (decodeChannelModel(selectedModel)?.channelId === "sucai-canvas") {
        return requestCanvasAudioGeneration(requestConfig, prompt, format, options);
    }
    const script = resolveModelScript(config, selectedModel);
    if (script) {
        if (!model) throw new Error("请先配置音频模型");
        if (!requestConfig.baseUrl.trim()) throw new Error("请先配置 Base URL");
        if (!requestConfig.apiKey.trim()) throw new Error("请先配置 API Key");
        try {
            const result = await runModelPlugin({
                capability: "audio",
                script,
                config: requestConfig,
                prompt,
                params: { voice: normalizeAudioVoiceValue(config.audioVoice), format, speed: normalizeAudioSpeedValue(config.audioSpeed), instructions: config.audioInstructions.trim() },
                signal: options?.signal,
            });
            return { blob: await audioPluginBlob(result, format), format };
        } catch (error) {
            throw new Error(readAxiosError(error, "音频生成失败"));
        }
    }
    assertAudioConfig(requestConfig, model);
    const instructions = config.audioInstructions.trim();

    try {
        const response = await axios.post<Blob>(
            aiApiUrl(requestConfig, "/audio/speech"),
            {
                model,
                input: prompt,
                voice: normalizeAudioVoiceValue(config.audioVoice),
                response_format: format,
                speed: Number(normalizeAudioSpeedValue(config.audioSpeed)),
                ...(instructions ? { instructions } : {}),
            },
            { headers: aiHeaders(requestConfig), responseType: "blob", signal: options?.signal },
        );
        await assertAudioBlob(response.data);
        return { blob: response.data.type.startsWith("audio/") ? response.data : new Blob([response.data], { type: audioMimeType(format) }), format };
    } catch (error) {
        throw new Error(readAxiosError(error, "音频生成失败"));
    }
}

/** Generate a free VoxCPM audition from a natural-language voice description. */
export async function requestVoiceDesign(description: string, options?: { signal?: AbortSignal; sampleText?: string }): Promise<GeneratedAudioResult> {
    const connection = useUserStore.getState().connection;
    if (!connection?.token) throw new Error("请先登录后设计音色");
    const response = await axios.post<Blob>(
        `${connection.canvasBaseUrl.replace(/\/+$/, "")}/v1/audio/design`,
        { description: description.trim(), ...(options?.sampleText ? { sampleText: options.sampleText } : {}) },
        { headers: { Authorization: `Bearer ${connection.token}` }, responseType: "blob", signal: options?.signal },
    );
    await assertAudioBlob(response.data);
    return { blob: response.data.type.startsWith("audio/") ? response.data : new Blob([response.data], { type: "audio/wav" }), format: "wav", mimeType: "audio/wav" };
}

async function audioPluginBlob(result: unknown, format: string): Promise<Blob> {
    if (result instanceof Blob) return result.type.startsWith("audio/") ? result : new Blob([result], { type: audioMimeType(format) });
    let source = "";
    if (typeof result === "string") source = result;
    else if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        source = typeof record.b64_json === "string" ? record.b64_json : typeof record.data === "string" ? record.data : typeof record.url === "string" ? record.url : "";
    }
    if (!source) throw new Error("模型调用脚本没有返回音频");
    const url = source.startsWith("data:") || /^https?:/i.test(source) ? source : `data:${audioMimeType(format)};base64,${source}`;
    const blob = await (await fetch(url)).blob();
    return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
}

export async function storeGeneratedAudio(result: GeneratedAudioResult, format = "mp3"): Promise<StoredGeneratedAudio> {
    if (result.stableUrl) {
        return {
            url: result.stableUrl,
            storageKey: "",
            bytes: 0,
            mimeType: result.mimeType || audioMimeType(result.format || format),
            taskId: result.taskId,
            engine: result.engine,
            voiceId: result.voiceId,
            format: result.format || format,
            characterCount: result.characterCount,
        };
    }
    if (!result.blob) throw new Error("音频生成接口没有返回可播放文件");
    const audio = result.blob.type.startsWith("audio/") ? result.blob : new Blob([result.blob], { type: audioMimeType(format) });
    return { ...(await uploadMediaFile(audio, "audio")), format: result.format || format };
}

export async function listCanvasAudioVoices(config: AiConfig, query: { search?: string; scope?: string; categoryId?: number } = {}, signal?: AbortSignal): Promise<CanvasAudioVoiceList> {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.audioModel);
    const response = await axios.get<{ data?: CanvasAudioVoice[]; favoriteCategories?: CanvasVoiceFavoriteCategory[]; favoriteCount?: number }>(aiApiUrl(requestConfig, "/audio/voices"), {
        headers: aiHeaders(requestConfig),
        params: { ...query, limit: 100 },
        signal,
    });
    return {
        voices: Array.isArray(response.data?.data) ? response.data.data : [],
        favoriteCategories: Array.isArray(response.data?.favoriteCategories) ? response.data.favoriteCategories : [],
        favoriteCount: Number(response.data?.favoriteCount || 0),
    };
}

async function requestCanvasAudioGeneration(config: AiConfig, prompt: string, format: string, options?: RequestOptions): Promise<GeneratedAudioResult> {
    const voiceId = Number(config.audioVoice);
    const referenceAudioMediaId = options?.referenceAudio ? await ensureReferenceAudioMediaId(options.referenceAudio) : "";
    if (!referenceAudioMediaId && (!Number.isInteger(voiceId) || voiceId <= 0)) throw new Error("请连接参考音频或从音色库选择音色");
    const engine = config.model === "voxcpm2" ? "voxcpm2" : "speech";
    const connection = useUserStore.getState().connection;
    if (!connection) throw new Error("请先登录后生成配音");
    const requestId = nanoid();
    const quote = await canvasBillingApi.quote(connection, {
        feature: "canvas.audio.speech", requestId, model: config.model, engine, input: prompt, ...(referenceAudioMediaId ? { referenceAudioMediaId } : { voiceId }), format,
        speed: Number(normalizeAudioSpeedValue(config.audioSpeed)),
    }, options?.signal);
    const response = await axios.post<{ task_id?: string; status?: string }>(
        aiApiUrl(config, "/audio/speech"),
        {
            model: config.model,
            engine,
            input: prompt,
            ...(referenceAudioMediaId
                ? { referenceAudioMediaId, referenceAudioName: options?.referenceAudio?.name || "参考音频" }
                : { voiceId }),
            format,
            speed: Number(normalizeAudioSpeedValue(config.audioSpeed)),
            emotion: config.audioInstructions.trim(),
            controlInstruction: config.audioInstructions.trim(),
            requestId,
            quoteToken: quote.quoteToken,
        },
        { headers: aiHeaders(config), signal: options?.signal },
    );
    const taskId = response.data?.task_id;
    if (!taskId) throw new Error("画布配音接口未返回任务 ID");
    options?.onTaskCreated?.({ taskId, engine, ...(referenceAudioMediaId ? {} : { voiceId }), characterCount: prompt.length });
    return pollCanvasAudioTask(config, taskId, options?.signal);
}

async function ensureReferenceAudioMediaId(reference: ReferenceAudio) {
    if (reference.mediaId) return reference.mediaId;
    if (!reference.storageKey) throw new Error("参考音频未同步到云端，请重新上传后再试");
    const blob = await getMediaBlob(reference.storageKey);
    if (!blob?.size) throw new Error("参考音频的本地文件已丢失，请重新上传后再试");
    const uploaded = await uploadCanvasMedia(blob, "audio");
    if (!uploaded?.mediaId) throw new Error("参考音频同步失败，请稍后重试");
    return uploaded.mediaId;
}

export async function pollCanvasAudioTask(config: AiConfig, taskId: string, signal?: AbortSignal): Promise<GeneratedAudioResult> {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.audioModel);
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
        await waitForAudioTaskPoll(3000, signal);
        const taskResponse = await axios.get<{
            status?: string;
            audio_url?: string;
            mime_type?: string;
            engine?: "speech" | "voxcpm2";
            voice_id?: number;
            format?: string;
            character_count?: number;
            error?: { message?: string };
        }>(aiApiUrl(requestConfig, `/audio/tasks/${encodeURIComponent(taskId)}`), { headers: aiHeaders(requestConfig), signal });
        const task = taskResponse.data;
        if (task.status === "canceled") throw new Error("配音任务已取消");
        if (task.status === "failed") throw new Error(task.error?.message || "配音生成失败");
        if (task.status !== "success") continue;
        if (!task.audio_url) throw new Error("配音任务成功但未返回音频地址");
        return {
            stableUrl: task.audio_url,
            taskId,
            engine: task.engine,
            voiceId: task.voice_id,
            format: task.format || config.audioFormat,
            characterCount: task.character_count,
            mimeType: task.mime_type || audioMimeType(task.format || config.audioFormat),
        };
    }
    throw new Error("配音生成等待超时，任务仍在后端处理中");
}

export async function cancelCanvasAudioTask(config: AiConfig, taskId: string) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.audioModel);
    await axios.post(aiApiUrl(requestConfig, `/audio/tasks/${encodeURIComponent(taskId)}/cancel`), {}, { headers: aiHeaders(requestConfig) });
}

function waitForAudioTaskPoll(delay: number, signal?: AbortSignal) {
    if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, delay);
        const onAbort = () => {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

function assertAudioConfig(config: AiConfig, model: string) {
    if (!model) throw new Error("请先配置音频模型");
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
    if (config.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持音频生成，请使用 OpenAI 格式渠道");
}

async function assertAudioBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; message?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "音频生成失败");
    if (payload.error?.message || payload.message) throw new Error(payload.error?.message || payload.message);
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; code?: number }>(error)) {
        const responseData = error.response?.data;
        return responseData?.msg || responseData?.error?.message || statusMessage(error.response?.status, fallback);
    }
    return error instanceof Error ? error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}（${status}）` : fallback;
}
