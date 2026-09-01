import { plainCanvasResourceMentions } from "./canvas-resource-references";

export const DISCOUNT_CHANNEL_PROMPT_LIMIT = 2500;
export const DISCOUNT_CHANNEL_PROMPT_WARNING = "特价渠道文字推荐2500以下，否则可能会生成失败。";

export function countCanvasPromptCharacters(prompt: string) {
    return Array.from(plainCanvasResourceMentions(prompt).replace(/\r\n/g, "\n")).length;
}

export function canvasPromptCharacterWarning(channel: string | undefined, count: number) {
    return channel === "50" && count > DISCOUNT_CHANNEL_PROMPT_LIMIT ? DISCOUNT_CHANNEL_PROMPT_WARNING : null;
}
