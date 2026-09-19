import { describe, expect, it } from "vitest";

import { adaptVideoCapabilitiesForModel, createModelChannel, encodeChannelModel, modelIconOf, normalizeChannelModels, normalizeVideoDuration, videoCapabilitiesOf, visibleCanvasVideoModes, type VideoModelCapabilities } from "./use-config-store";
import { defaultConfig, useConfigStore } from "./use-config-store";

describe("backend video model capabilities", () => {
    it("does not expose an unpublished bundled video model by default", () => {
        expect(defaultConfig.videoModel).toBe("");
        expect(defaultConfig.channels.flatMap((channel) => channel.models).filter((model) => model.capability === "video")).toEqual([]);
    });

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

    it("preserves the server-provided video model icon for the picker", () => {
        const value = encodeChannelModel("sucai", "seedance-2.0");
        const channel = createModelChannel({ id: "sucai", models: [{ name: "seedance-2.0", capability: "video", icon: "clapperboard", iconUrl: "https://cdn.example.com/seedance.svg" }] });
        const config = { ...defaultConfig, channels: [channel], models: [value] };

        expect(modelIconOf(config, value)).toEqual({ capability: "video", icon: "clapperboard", iconUrl: "https://cdn.example.com/seedance.svg" });
    });

    it("temporarily hides first-frame and first-last-frame generation modes", () => {
        expect(visibleCanvasVideoModes(["text2video", "image2video", "frames2video", "first-frame-to-video"])).toEqual(["text2video", "image2video"]);
    });

    it("never normalizes a generated duration below five seconds", () => {
        expect(normalizeVideoDuration("2")).toBe(5);
        expect(normalizeVideoDuration("2", { min: 2, max: 30, options: null })).toBe(5);
        expect(normalizeVideoDuration("2", { min: 2, max: 30, options: [2, 4, 6] })).toBe(6);
    });

    it("adapts the XKMJAI fixed-price video models", () => {
        const base = {
            provider: "canvas-video" as const,
            displayName: "模型",
            channel: "xkmjai",
            upstreamModel: "model",
            qualities: [{ quality: "720p", pricing: { type: "per_second", credits: 52 } }],
            aspectRatios: ["16:9"],
            duration: { options: [5, 10] },
            modes: ["text2video"],
            inputImagesMax: 0,
            inputVideosMax: 0,
            inputAudiosMax: 0,
        } satisfies VideoModelCapabilities;

        const wan = adaptVideoCapabilitiesForModel("wan-3.0-cc", "XKMJAI", base);
        expect(wan.qualities).toEqual([{ quality: "720p", pricing: { type: "fixed_total", credits: 52 } }]);
        expect(wan.duration).toEqual({ options: null, min: 5, max: 30 });

        const sd = adaptVideoCapabilitiesForModel("SD-2.5-HM-2", "channel xkmjai", base);
        expect(sd.qualities[0].quality).toBe("720p");
        expect(sd.qualities[0].pricing.type).toBe("fixed_total");
        expect(adaptVideoCapabilitiesForModel("published-wan", "XKMJAI_VIDEO_BASE_URL", { ...base, upstreamModel: "wan-3.0-cc" }).qualities[0].quality).toBe("720p");
        expect(adaptVideoCapabilitiesForModel("wan-3.0-cc", "other", base)).toBe(base);
    });
});

describe("video extension parameters on model switch", () => {
    const withParameters: VideoModelCapabilities = {
        provider: "canvas-video",
        displayName: "ModelHub Seedance",
        channel: "modelhub",
        upstreamModel: "seedance-2.0",
        qualities: [{ quality: "720p", pricing: { type: "per_second", credits: 52 } }],
        aspectRatios: ["16:9"],
        duration: { options: [5] },
        modes: ["text2video"],
        inputImagesMax: 0,
        inputVideosMax: 0,
        inputAudiosMax: 0,
        parameters: [{ key: "generate_audio", label: "生成音频", type: "toggle", defaultValue: true }],
    };
    // 目标模型完全没有扩展参数（对齐线上 aistartlab / hot-apis / 星空 / Boyesir 的实际情况）
    const withoutParameters: VideoModelCapabilities = { ...withParameters, displayName: "AIStartLab Seedance", channel: "aistartlab", upstreamModel: "seedance-2.0-fast", parameters: undefined };

    function setup() {
        const models = normalizeChannelModels([
            { name: "seedance-2.0", capability: "video", videoCapabilities: withParameters },
            { name: "seedance-2.0-fast", capability: "video", videoCapabilities: withoutParameters },
        ]);
        const channel = createModelChannel({ id: "sucai", models });
        const withValue = encodeChannelModel(channel.id, "seedance-2.0");
        const withoutValue = encodeChannelModel(channel.id, "seedance-2.0-fast");
        useConfigStore.setState({
            config: { ...defaultConfig, channels: [channel], models: [withValue, withoutValue], videoModel: withValue, videoParameters: { generate_audio: true, stale: 1 } },
        });
        return { withValue, withoutValue };
    }

    it("drops extension parameters that the next model does not declare", () => {
        const { withValue, withoutValue } = setup();
        useConfigStore.getState().updateConfig("videoModel", withoutValue);
        expect(useConfigStore.getState().config.videoParameters).toEqual({});
        useConfigStore.getState().updateConfig("videoModel", withValue);
        expect(useConfigStore.getState().config.videoParameters).toEqual({ generate_audio: true });
    });
});
