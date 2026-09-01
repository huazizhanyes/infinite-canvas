type CanvasMediaPlaybackElement = Pick<HTMLMediaElement, "pause" | "paused">;

const CANVAS_MEDIA_SELECTOR = "video[data-canvas-exclusive-media], audio[data-canvas-exclusive-media]";

export function pauseOtherCanvasMedia(current: CanvasMediaPlaybackElement, mediaElements?: Iterable<CanvasMediaPlaybackElement>) {
    const candidates = mediaElements || document.querySelectorAll<HTMLMediaElement>(CANVAS_MEDIA_SELECTOR);
    let pausedCount = 0;
    for (const media of candidates) {
        if (media === current || media.paused) continue;
        media.pause();
        pausedCount += 1;
    }
    return pausedCount;
}
