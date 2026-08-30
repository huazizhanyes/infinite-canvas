export type CanvasVideoFrameKind = "first" | "last" | "current";

export type CapturedVideoFrame = {
    blob: Blob;
    time: number;
    width: number;
    height: number;
};

const CAPTURE_VIDEO_CACHE_SIZE = 3;
const captureVideos = new Map<string, HTMLVideoElement>();

export function videoFrameCaptureTime(kind: CanvasVideoFrameKind, duration: number, currentTime: number) {
    const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
    const safeCurrentTime = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
    if (kind === "first") return 0;
    if (kind === "last") return Math.max(0, safeDuration - Math.min(0.05, safeDuration / 2));
    return Math.min(safeCurrentTime, safeDuration || safeCurrentTime);
}

export async function captureVideoFrame(video: HTMLVideoElement, kind: CanvasVideoFrameKind): Promise<CapturedVideoFrame> {
    await ensureVideoMetadata(video);
    if (!video.videoWidth || !video.videoHeight) throw new Error("无法读取视频画面尺寸");

    const captureSource = kind === "current" ? video : getCaptureVideo(video);

    try {
        await ensureVideoMetadata(captureSource);
        const captureTime = videoFrameCaptureTime(kind, captureSource.duration, video.currentTime);
        if (kind !== "current") await seekVideo(captureSource, captureTime);
        const canvas = document.createElement("canvas");
        canvas.width = captureSource.videoWidth;
        canvas.height = captureSource.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器无法创建截帧画布");
        context.drawImage(captureSource, 0, 0, canvas.width, canvas.height);
        const blob = await canvasToBlob(canvas);
        return { blob, time: captureTime, width: canvas.width, height: canvas.height };
    } catch (error) {
        if (captureSource !== video) discardCaptureVideo(captureSource);
        if (error instanceof DOMException && error.name === "SecurityError") throw new Error("视频源不允许跨域截帧，请重新上传视频后再试");
        throw error;
    }
}

function getCaptureVideo(source: HTMLVideoElement) {
    const src = source.currentSrc || source.src;
    const cached = captureVideos.get(src);
    if (cached) {
        captureVideos.delete(src);
        captureVideos.set(src, cached);
        return cached;
    }
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    if (source.crossOrigin) video.crossOrigin = source.crossOrigin;
    video.src = src;
    video.load();
    captureVideos.set(src, video);
    while (captureVideos.size > CAPTURE_VIDEO_CACHE_SIZE) discardCaptureVideo(captureVideos.values().next().value);
    return video;
}

function discardCaptureVideo(video?: HTMLVideoElement) {
    if (!video) return;
    captureVideos.forEach((cached, src) => {
        if (cached === video) captureVideos.delete(src);
    });
    video.removeAttribute("src");
    video.load();
}

async function ensureVideoMetadata(video: HTMLVideoElement) {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return;
    await waitForVideoEvent(video, "loadedmetadata");
}

async function seekVideo(video: HTMLVideoElement, time: number) {
    const target = Math.max(0, Math.min(time, Number.isFinite(video.duration) ? video.duration : time));
    if (Math.abs(video.currentTime - target) < 0.01 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const waiting = waitForVideoEvent(video, "seeked");
    video.currentTime = target;
    await waiting;
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: "loadedmetadata" | "seeked") {
    return new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => finish(() => reject(new Error("视频读取超时，请重试"))), 10_000);
        const onSuccess = () => finish(resolve);
        const onError = () => finish(() => reject(new Error("视频画面读取失败")));
        const finish = (callback: () => void) => {
            window.clearTimeout(timeout);
            video.removeEventListener(eventName, onSuccess);
            video.removeEventListener("error", onError);
            callback();
        };
        video.addEventListener(eventName, onSuccess, { once: true });
        video.addEventListener("error", onError, { once: true });
    });
}

function canvasToBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("视频帧编码失败")), "image/png");
    });
}
