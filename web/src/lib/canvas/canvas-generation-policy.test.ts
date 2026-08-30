import { describe, expect, it } from "vitest";

import { CanvasNodeType } from "@/types/canvas";
import { isNonInterruptibleVideoGeneration } from "./canvas-generation-policy";

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
