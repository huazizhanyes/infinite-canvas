export const MAX_AUDIO_EXTRACT_DURATION_MS = 10_000;
export const MIN_AUDIO_EXTRACT_DURATION_MS = 500;

export type CanvasAudioExtractRange = {
    startMs: number;
    endMs: number;
};

export type CanvasAudioExtractResult = CanvasAudioExtractRange & {
    blob: Blob;
    mimeType: string;
    durationMs: number;
};

type CaptureVideoElement = HTMLVideoElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
};

const AUDIO_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"];

export function normalizeAudioExtractRange(range: CanvasAudioExtractRange, durationMs: number): CanvasAudioExtractRange {
    const duration = Math.max(0, Math.round(durationMs));
    if (!duration) return { startMs: 0, endMs: 0 };
    const minSpan = Math.min(MIN_AUDIO_EXTRACT_DURATION_MS, duration);
    const startMs = clamp(Math.round(range.startMs), 0, Math.max(0, duration - minSpan));
    let endMs = clamp(Math.round(range.endMs), startMs + minSpan, duration);
    if (endMs - startMs > MAX_AUDIO_EXTRACT_DURATION_MS) endMs = startMs + MAX_AUDIO_EXTRACT_DURATION_MS;
    return { startMs, endMs };
}

export function formatAudioClipTime(milliseconds: number) {
    const totalTenths = Math.max(0, Math.round(milliseconds / 100));
    const minutes = Math.floor(totalTenths / 600);
    const seconds = Math.floor((totalTenths % 600) / 10);
    const tenths = totalTenths % 10;
    return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

export async function captureVideoAudioSegment(
    video: HTMLVideoElement,
    range: CanvasAudioExtractRange,
    options: { signal?: AbortSignal; onProgress?: (elapsedMs: number) => void } = {},
): Promise<CanvasAudioExtractResult> {
    if (typeof MediaRecorder === "undefined") throw new Error("当前浏览器不支持音频提取，请使用新版 Chrome、Edge 或 Firefox");
    const durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0;
    const normalized = normalizeAudioExtractRange(range, durationMs);
    if (normalized.endMs <= normalized.startMs) throw new Error("请选择有效的音频片段");

    const captureStream = (video as CaptureVideoElement).captureStream || (video as CaptureVideoElement).mozCaptureStream;
    if (!captureStream) throw new Error("当前浏览器不支持从视频中提取音频");
    let sourceStream: MediaStream;
    try {
        sourceStream = captureStream.call(video);
    } catch {
        throw new Error("无法读取视频音轨，请确认视频包含音频；远端视频也可能受浏览器跨域限制影响");
    }
    const audioTracks = sourceStream.getAudioTracks();
    if (!audioTracks.length) {
        sourceStream.getTracks().forEach((track) => track.stop());
        throw new Error("当前视频没有可分离的音频轨道");
    }

    const audioStream = new MediaStream(audioTracks);
    const mimeType = preferredAudioMimeType();
    let recorder: MediaRecorder;
    try {
        recorder = mimeType ? new MediaRecorder(audioStream, { mimeType }) : new MediaRecorder(audioStream);
    } catch {
        sourceStream.getTracks().forEach((track) => track.stop());
        throw new Error("当前浏览器无法录制该视频的音频格式");
    }
    const chunks: BlobPart[] = [];
    const stopped = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => {
            if (event.data.size) chunks.push(event.data);
        };
        recorder.onerror = () => reject(new Error("音频录制失败，请重试"));
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }));
    });

    const previousMuted = video.muted;
    const previousPlaybackRate = video.playbackRate;
    let recording = false;
    try {
        video.pause();
        video.muted = false;
        video.playbackRate = 1;
        await seekVideo(video, normalized.startMs / 1000, options.signal);
        if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");

        recorder.start(250);
        recording = true;
        await video.play();
        await waitForSegmentEnd(video, normalized, options.signal, options.onProgress);
        recorder.stop();
        recording = false;
        const recordedBlob = await stopped;
        if (!recordedBlob.size) throw new Error("没有录制到音频，请检查视频音轨后重试");
        const blob = await audioBlobToWav(recordedBlob);
        return {
            ...normalized,
            blob,
            mimeType: "audio/wav",
            durationMs: normalized.endMs - normalized.startMs,
        };
    } finally {
        if (recording && recorder.state !== "inactive") recorder.stop();
        video.pause();
        video.muted = previousMuted;
        video.playbackRate = previousPlaybackRate;
        sourceStream.getTracks().forEach((track) => track.stop());
    }
}

function preferredAudioMimeType() {
    if (typeof MediaRecorder.isTypeSupported !== "function") return "";
    return AUDIO_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function audioBlobToWav(blob: Blob) {
    if (typeof AudioContext === "undefined") throw new Error("当前浏览器不支持音频格式转换，请使用新版 Chrome、Edge 或 Firefox");
    const context = new AudioContext();
    try {
        const audio = await context.decodeAudioData(await blob.arrayBuffer());
        return encodeWav(audio);
    } catch {
        throw new Error("音频转换为 WAV 失败，请重试");
    } finally {
        await context.close().catch(() => undefined);
    }
}

export function encodeWav(audio: AudioBuffer) {
    const channels = Math.max(1, audio.numberOfChannels);
    const bytesPerSample = 2;
    const dataSize = audio.length * channels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, audio.sampleRate, true);
    view.setUint32(28, audio.sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataSize, true);

    const channelData = Array.from({ length: channels }, (_, index) => audio.getChannelData(index));
    let offset = 44;
    for (let sampleIndex = 0; sampleIndex < audio.length; sampleIndex += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
            const sample = Math.max(-1, Math.min(1, channelData[channel][sampleIndex] || 0));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += bytesPerSample;
        }
    }
    return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, value: string) {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function seekVideo(video: HTMLVideoElement, time: number, signal?: AbortSignal) {
    if (Math.abs(video.currentTime - time) < 0.05) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            video.removeEventListener("seeked", onSeeked);
            video.removeEventListener("error", onError);
            signal?.removeEventListener("abort", onAbort);
        };
        const onSeeked = () => {
            cleanup();
            resolve();
        };
        const onError = () => {
            cleanup();
            reject(new Error("视频定位失败，请重试"));
        };
        const onAbort = () => {
            cleanup();
            reject(new DOMException("Aborted", "AbortError"));
        };
        video.addEventListener("seeked", onSeeked, { once: true });
        video.addEventListener("error", onError, { once: true });
        signal?.addEventListener("abort", onAbort, { once: true });
        video.currentTime = time;
    });
}

function waitForSegmentEnd(video: HTMLVideoElement, range: CanvasAudioExtractRange, signal: AbortSignal | undefined, onProgress: ((elapsedMs: number) => void) | undefined) {
    return new Promise<void>((resolve, reject) => {
        let frame = 0;
        const cleanup = () => {
            if (frame) window.cancelAnimationFrame(frame);
            signal?.removeEventListener("abort", onAbort);
        };
        const onAbort = () => {
            cleanup();
            reject(new DOMException("Aborted", "AbortError"));
        };
        const tick = () => {
            if (signal?.aborted) return onAbort();
            const elapsedMs = Math.max(0, video.currentTime * 1000 - range.startMs);
            onProgress?.(Math.min(elapsedMs, range.endMs - range.startMs));
            if (video.currentTime * 1000 >= range.endMs - 20 || video.ended) {
                cleanup();
                resolve();
                return;
            }
            frame = window.requestAnimationFrame(tick);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        tick();
    });
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
