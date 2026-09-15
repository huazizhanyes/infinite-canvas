import { describe, expect, it } from "vitest";

import { durationSliderPresentation } from "./video-settings-panel";

describe("video duration slider", () => {
    it("keeps every middle value selectable for continuous duration options", () => {
        const values = Array.from({ length: 11 }, (_, index) => index + 5);
        expect(durationSliderPresentation(values, 5, 15)).toEqual({
            step: 1,
            marks: { 5: "5s", 15: "15s" },
        });
    });

    it("keeps non-continuous discrete values as valid slider marks", () => {
        expect(durationSliderPresentation([5, 10, 15], 5, 15)).toEqual({
            step: null,
            marks: { 5: "5s", 10: " ", 15: "15s" },
        });
    });

    it("keeps range-based duration sliders on one-second steps", () => {
        expect(durationSliderPresentation([], 5, 30)).toEqual({
            step: 1,
            marks: { 5: "5s", 30: "30s" },
        });
    });
});