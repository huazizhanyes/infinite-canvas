import { describe, expect, it } from "vitest";

import { formatAudioClipTime, MAX_AUDIO_EXTRACT_DURATION_MS, normalizeAudioExtractRange } from "./canvas-audio-extract";

describe("canvas audio extract", () => {
    it("limits the selected range to ten seconds", () => {
        expect(normalizeAudioExtractRange({ startMs: 5_000, endMs: 20_000 }, 30_000)).toEqual({ startMs: 5_000, endMs: 5_000 + MAX_AUDIO_EXTRACT_DURATION_MS });
    });

    it("keeps a minimum selectable span", () => {
        expect(normalizeAudioExtractRange({ startMs: 1_000, endMs: 1_200 }, 10_000)).toEqual({ startMs: 1_000, endMs: 1_500 });
    });

    it("formats clip timestamps with tenths", () => {
        expect(formatAudioClipTime(0)).toBe("0:00.0");
        expect(formatAudioClipTime(10_000)).toBe("0:10.0");
        expect(formatAudioClipTime(60_000)).toBe("1:00.0");
    });
});
