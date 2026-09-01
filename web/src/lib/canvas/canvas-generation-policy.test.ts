import { describe, expect, it } from "vitest";

import { CanvasNodeType } from "@/types/canvas";
import { isNonInterruptibleVideoGeneration, videoModelSelectionPatch } from "./canvas-generation-policy";

describe("isNonInterruptibleVideoGeneration", () => {
    it("locks a running video task", () => {
        expect(isNonInterruptibleVideoGeneration(CanvasNodeType.Video, true)).toBe(true);
    });

    it("does not lock a video before submission", () => {
        expect(isNonInterruptibleVideoGeneration(CanvasNodeType.Video, false)).toBe(false);
    });

    it("keeps non-video generation interruptible", () => {
        expect(isNonInterruptibleVideoGeneration(CanvasNodeType.Image, true)).toBe(false);
        expect(isNonInterruptibleVideoGeneration(CanvasNodeType.Text, true)).toBe(false);
        expect(isNonInterruptibleVideoGeneration(CanvasNodeType.Audio, true)).toBe(false);
    });
});

describe("videoModelSelectionPatch", () => {
    it("resets every newly selected video model to five seconds", () => {
        expect(videoModelSelectionPatch("video-model-b")).toEqual({ model: "video-model-b", seconds: "5" });
        expect(videoModelSelectionPatch("video-model-c", "1080p")).toEqual({ model: "video-model-c", seconds: "5", vquality: "1080p" });
    });
});
