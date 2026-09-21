import { describe, expect, it } from "vitest";

import { buildModelGroups, channelAliasForModel, sortVideoModelsByMark, videoBillingBadgeLabel } from "./model-picker";
import { encodeChannelModel, type AiConfig, type VideoModelCapabilities } from "@/stores/use-config-store";

const capabilities = (qualities: VideoModelCapabilities["qualities"]) => ({
    provider: "canvas-video" as const,
    displayName: "模型",
    channel: "xkmjai",
    upstreamModel: "model",
    qualities,
    aspectRatios: ["16:9"],
    duration: { min: 5, max: 30, options: null },
    modes: ["text2video"],
    inputImagesMax: 0,
    inputVideosMax: 0,
    inputAudiosMax: 0,
});

describe("video billing badge", () => {
    it("shows task prices with the /条 suffix", () => {
        expect(videoBillingBadgeLabel(capabilities([{ quality: "720p", pricing: { type: "fixed_total", normalPriceMicros: 6950000 } }]))).toBe("¥6.95/条");
    });

    it("shows per-second prices with the Chinese seconds suffix", () => {
        expect(videoBillingBadgeLabel(capabilities([{ quality: "720p", pricing: { type: "per_second", normalPriceMicros: 180000 } }]))).toBe("¥0.18/秒");
    });

    it("uses the diamond member price when tier prices are available", () => {
        expect(videoBillingBadgeLabel(capabilities([{ quality: "720p", pricing: { type: "per_second", normalPriceMicros: 420000, tierPricesMicros: { NORMAL: 420000, SILVER: 390000, GOLD: 360000, DIAMOND: 330000 } } }]))).toBe("¥0.33/秒");
    });

    it("always keeps two decimal places", () => {
        expect(videoBillingBadgeLabel(capabilities([{ quality: "720p", pricing: { type: "per_second", normalPriceMicros: 200000 } }]))).toBe("¥0.20/秒");
        expect(videoBillingBadgeLabel(capabilities([{ quality: "720p", pricing: { type: "fixed_total", normalPriceMicros: 4800000 } }]))).toBe("¥4.80/条");
    });

    it("uses the lowest price without a starting-from marker", () => {
        expect(videoBillingBadgeLabel(capabilities([
            { quality: "720p", pricing: { type: "fixed_total", normalPriceMicros: 6950000 } },
            { quality: "1080p", pricing: { type: "fixed_total", normalPriceMicros: 8950000 } },
        ]))).toBe("¥6.95/条");
    });

    it("shows both units when a model mixes task and second billing", () => {
        expect(videoBillingBadgeLabel(capabilities([
            { quality: "720p", pricing: { type: "fixed_total", normalPriceMicros: 6950000 } },
            { quality: "1080p", pricing: { type: "per_second", normalPriceMicros: 180000 } },
        ]))).toBe("¥6.95/条 · ¥0.18/秒");
    });

    it("keeps the billing-only label when the API has no sale price", () => {
        expect(videoBillingBadgeLabel(capabilities([{ quality: "720p", pricing: { type: "fixed_total" } }]))).toBe("按条");
    });
});

describe("video model mark sorting", () => {
    const videoModel = (name: string, marked?: boolean) => ({
        name,
        displayName: name,
        capability: "video" as const,
        videoCapabilities: { ...capabilities([]), displayName: name, marked },
    });

    const config = {
        channelMode: "remote",
        channels: [
            {
                id: "sucai",
                name: "闪帧",
                baseUrl: "https://example.com",
                apiKey: "k",
                apiFormat: "openai",
                models: [videoModel("a"), videoModel("b", true), videoModel("c"), videoModel("d", true)],
            },
        ],
    } as unknown as AiConfig;

    it("puts marked models first and keeps the others in their original order", () => {
        const models = ["sucai::a", "sucai::b", "sucai::c", "sucai::d"].map((value) => encodeChannelModel("sucai", value.split("::")[1]));
        expect(sortVideoModelsByMark(models, config)).toEqual(["sucai::b", "sucai::d", "sucai::a", "sucai::c"]);
    });

    it("does not reorder anything when no model is marked", () => {
        const plain = {
            ...config,
            channels: [{ ...config.channels[0], models: config.channels[0].models.map((model) => ({ ...model, videoCapabilities: { ...model.videoCapabilities, marked: undefined } })) }],
        } as unknown as AiConfig;
        const models = ["sucai::a", "sucai::b", "sucai::c", "sucai::d"].map((value) => encodeChannelModel("sucai", value.split("::")[1]));
        expect(sortVideoModelsByMark(models, plain)).toEqual(["sucai::a", "sucai::b", "sucai::c", "sucai::d"]);
    });
});

describe("video model provider aliases", () => {
    const videoModel = (name: string, provider: string, channel = `${provider}-route`, routeLabel = `${provider} 线路`) => ({
        name,
        displayName: name,
        capability: "video" as const,
        videoCapabilities: { ...capabilities([]), displayName: name, channel, upstreamProvider: provider, upstreamModel: name, routeLabel },
    });

    it("groups one backend provider even when it owns many route channels", () => {
        const config = {
            channelMode: "remote",
            channels: [
                {
                    id: "sucai-canvas",
                    name: "闪帧 AI 画布",
                    baseUrl: "https://example.com",
                    apiKey: "k",
                    apiFormat: "openai",
                    models: [
                        videoModel("seedance-a", "modelhub", "modelhub-seedance-a", "Seedance2.0-推荐-专线A"),
                        videoModel("seedance-b", "modelhub", "modelhub-seedance-b", "Seedance2.0-推荐-专线B"),
                    ],
                },
            ],
        } as unknown as AiConfig;

        const groups = buildModelGroups(config, ["sucai-canvas::seedance-a", "sucai-canvas::seedance-b"]);

        expect(groups).toHaveLength(1);
        expect(groups[0].alias).toBe("C");
        expect(groups[0].models).toHaveLength(2);
    });

    it("gives each of the four providers its own A/B/C/D alias", () => {
        const config = {
            channelMode: "remote",
            channels: [
                {
                    id: "sucai-canvas",
                    name: "闪帧 AI 画布",
                    baseUrl: "https://example.com",
                    apiKey: "k",
                    apiFormat: "openai",
                    models: [
                        videoModel("aistartlab-one", "aistartlab"),
                        videoModel("hot-one", "hot-apis"),
                        videoModel("modelhub-one", "modelhub"),
                        videoModel("xkmjai-one", "xkmjai"),
                    ],
                },
            ],
        } as unknown as AiConfig;
        const models = config.channels[0].models.map((model) => `sucai-canvas::${model.name}`);

        expect(buildModelGroups(config, models).map((group) => group.alias)).toEqual(["A", "B", "C", "D"]);
        expect(channelAliasForModel(config, "sucai-canvas::modelhub-one")).toBe("C");
    });

    it("keeps a provider alias stable when the backend reorders the catalog", () => {
        const models = [videoModel("modelhub-one", "modelhub"), videoModel("xkmjai-one", "xkmjai")];
        const base = {
            channelMode: "remote",
            channels: [{ id: "sucai-canvas", name: "闪帧 AI 画布", baseUrl: "https://example.com", apiKey: "k", apiFormat: "openai", models }],
        } as unknown as AiConfig;
        const reordered = { ...base, channels: [{ ...base.channels[0], models: [...models].reverse() }] } as unknown as AiConfig;

        expect(channelAliasForModel(reordered, "sucai-canvas::modelhub-one")).toBe("C");
        expect(channelAliasForModel(reordered, "sucai-canvas::xkmjai-one")).toBe("D");
    });

    it("uses the backend-configured channel alias", () => {
        const configured = videoModel("paipu-one", "paipu");
        const configuredWithAlias = { ...configured, videoCapabilities: { ...configured.videoCapabilities, channelAlias: "F" } };
        const config = {
            channelMode: "remote",
            channels: [{ id: "sucai-canvas", name: "闪帧 AI 画布", baseUrl: "https://example.com", apiKey: "k", apiFormat: "openai", models: [configuredWithAlias] }],
        } as unknown as AiConfig;

        expect(channelAliasForModel(config, "sucai-canvas::paipu-one")).toBe("F");
    });
});
