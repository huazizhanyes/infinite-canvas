import { describe, expect, it } from "vitest";

import { serializeCanvasResourceMention } from "./canvas-resource-references";
import { DISCOUNT_CHANNEL_PROMPT_WARNING, canvasPromptCharacterWarning, countCanvasPromptCharacters } from "./canvas-prompt-character-count";

describe("countCanvasPromptCharacters", () => {
    it("counts Chinese, English, spaces, line breaks, and punctuation one by one", () => {
        expect(countCanvasPromptCharacters("中A ！\nB")).toBe(6);
        expect(countCanvasPromptCharacters("第一行\r\n第二行")).toBe(7);
    });

    it("counts a structured mention by its visible label instead of its stored node id", () => {
        const mention = serializeCanvasResourceMention("a-very-long-hidden-node-id", "图片6");
        expect(countCanvasPromptCharacters(`${mention} 追逐`)).toBe(7);
    });

    it("warns only when channel 50 exceeds 2500 visible characters", () => {
        expect(canvasPromptCharacterWarning("50", 2500)).toBeNull();
        expect(canvasPromptCharacterWarning("50", 2501)).toBe(DISCOUNT_CHANNEL_PROMPT_WARNING);
        expect(canvasPromptCharacterWarning("49", 2501)).toBeNull();
        expect(canvasPromptCharacterWarning(undefined, 2501)).toBeNull();
    });
});
