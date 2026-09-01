import { describe, expect, it, vi } from "vitest";

import { pauseOtherCanvasMedia } from "./canvas-media-playback";

function media(paused: boolean) {
    return { paused, pause: vi.fn() };
}

describe("pauseOtherCanvasMedia", () => {
    it("pauses every other playing video or audio while leaving paused media alone", () => {
        const current = media(false);
        const playingVideo = media(false);
        const playingAudio = media(false);
        const pausedAudio = media(true);

        expect(pauseOtherCanvasMedia(current, [current, playingVideo, playingAudio, pausedAudio])).toBe(2);
        expect(current.pause).not.toHaveBeenCalled();
        expect(playingVideo.pause).toHaveBeenCalledOnce();
        expect(playingAudio.pause).toHaveBeenCalledOnce();
        expect(pausedAudio.pause).not.toHaveBeenCalled();
    });
});
