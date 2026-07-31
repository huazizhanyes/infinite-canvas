import { describe, expect, it } from "vitest";

import { createModelChannel, encodeChannelModel, normalizeChannelModels, videoCapabilitiesOf, type VideoModelCapabilities } from "./use-config-store";
import { defaultConfig } from "./use-config-store";

describe("backend video model capabilities", () => {
    it("preserves server-provided capabilities instead of guessing from the model name", () => {
        const videoCapabilities: VideoModelCapabilities = {
            provider: "canvas-video",
            displayName: "Seedance 2.0",
            channel: "12",
            upstreamModel: "opaque-model",
            qualities: [{ quality: "720p", pricing: { type: "per_second", credits: 52 } }],
            aspectRatios: ["16:9"],
            duration: { options: [5, 10] },
            modes: ["text2video", "frames2video"],
            inputImagesMax: 2,
            inputVideosMax: 1,
            inputAudiosMax: 1,
        };
        const models = normalizeChannelModels([{ name: "opaque-model-id", capability: "video", videoCapabilities }]);
        const channel = createModelChannel({ id: "sucai", models });
        const config = { ...defaultConfig, channels: [channel], models: [encodeChannelModel(channel.id, "opaque-model-id")] };

        expect(videoCapabilitiesOf(config, encodeChannelModel(channel.id, "opaque-model-id"))).toEqual(videoCapabilities);
    });
});
