import { describe, expect, it } from "vitest";

import { createModelChannel, defaultConfig, encodeChannelModel, resolveImageOutputTier } from "@/stores/use-config-store";
import { parseCanvasImageTaskItems, resolveImageModelValue } from "./image";

describe("canvas image model resolution", () => {
    const channel = createModelChannel({
        id: "sucai-canvas",
        models: [
            { name: "gpt-image-2.5-sunburst", capability: "image" },
            { name: "gemini-3.1-flash-image-preview", capability: "image" },
            { name: "gpt-5.5", capability: "text" },
        ],
    });
    const globalImageModel = encodeChannelModel(channel.id, "gpt-image-2.5-sunburst");
    const nodeModel = encodeChannelModel(channel.id, "gemini-3.1-flash-image-preview");

    it("bills the model picked on the node instead of the global default image model", () => {
        const config = { ...defaultConfig, channels: [channel], model: nodeModel, imageModel: globalImageModel };
        expect(resolveImageModelValue(config)).toBe(nodeModel);
    });

    it("falls back to the image model when `model` is not an image model", () => {
        const config = { ...defaultConfig, channels: [channel], model: encodeChannelModel(channel.id, "gpt-5.5"), imageModel: globalImageModel };
        expect(resolveImageModelValue(config)).toBe(globalImageModel);
    });
});

describe("canvas image task items", () => {
    it("keeps backend item indexes when only part of a batch has completed", () => {
        const items = parseCanvasImageTaskItems({ task_id: "task-1", status: "partial_success", data: [{ index: 1, url: "https://example.test/1.png", status: "success" }, { index: 2, url: "https://example.test/2.png", status: "success" }] });
        expect(items).toEqual([
            { index: 1, dataUrl: "https://example.test/1.png", status: "success" },
            { index: 2, dataUrl: "https://example.test/2.png", status: "success" },
        ]);
    });
});

describe("image output tier resolution", () => {
    const paidChannel = createModelChannel({
        id: "sucai-canvas",
        models: [{ name: "gemini-3.1-flash-image-preview", capability: "image", nativeQuality: true, billingPolicy: "wallet_only", qualityOptions: ["1k", "2k", "4k"] }],
    });
    const paidModel = encodeChannelModel(paidChannel.id, "gemini-3.1-flash-image-preview");
    const paidConfig = (imageOutputTier: any) => ({ ...defaultConfig, channels: [paidChannel], model: paidModel, imageModel: paidModel, imageOutputTier });

    it("keeps a supported tier", () => {
        expect(resolveImageOutputTier(paidConfig("1k"), paidModel)).toBe("1k");
    });

    it("falls back to the first tier the menu shows instead of the global 2k default", () => {
        expect(resolveImageOutputTier(paidConfig(undefined), paidModel)).toBe("1k");
        expect(resolveImageOutputTier(paidConfig(""), paidModel)).toBe("1k");
    });

    it("normalises casing so the sent tier matches the menu", () => {
        expect(resolveImageOutputTier(paidConfig("1K"), paidModel)).toBe("1k");
    });

    it("resolves an unsupported stored tier to a tier the model actually supports", () => {
        expect(resolveImageOutputTier(paidConfig("4k"), paidModel)).toBe("4k");
        expect(resolveImageOutputTier({ ...paidConfig("1k"), channels: [createModelChannel({ id: "c", models: [{ name: "free", capability: "image" }] })], model: encodeChannelModel("c", "free"), imageModel: encodeChannelModel("c", "free") }, encodeChannelModel("c", "free"))).toBe("2k");
    });
});
