import { describe, expect, it } from "vitest";

import type { VideoParameterDefinition } from "@/stores/use-config-store";
import { sanitizeVideoParameters, videoParametersForModel } from "./video-parameters";

const generateAudio: VideoParameterDefinition = {
    key: "generate_audio",
    label: "生成音频",
    type: "toggle",
    defaultValue: true,
};

const camera: VideoParameterDefinition = {
    key: "camera",
    label: "镜头",
    type: "select",
    defaultValue: "wide",
    options: [{ value: "wide" }, { value: "close" }],
};

describe("sanitizeVideoParameters", () => {
    it("drops values left over from another model", () => {
        // 线上故障场景：模型没有扩展参数，但本地还残留上一个模型的 generate_audio
        expect(sanitizeVideoParameters([], { generate_audio: true })).toEqual({});
        expect(sanitizeVideoParameters(undefined, { generate_audio: true })).toEqual({});
        expect(sanitizeVideoParameters([camera], { generate_audio: true })).toEqual({});
    });

    it("keeps declared values, including falsy ones", () => {
        expect(sanitizeVideoParameters([generateAudio], { generate_audio: false })).toEqual({ generate_audio: false });
        expect(sanitizeVideoParameters([camera], { camera: "close", generate_audio: true })).toEqual({ camera: "close" });
        expect(sanitizeVideoParameters([camera], { camera: 0 })).toEqual({ camera: 0 });
        expect(sanitizeVideoParameters([camera], { camera: "" })).toEqual({ camera: "" });
    });

    it("does not treat declared-but-absent keys as a value", () => {
        expect(sanitizeVideoParameters([camera], { camera: undefined })).toEqual({});
    });

    it("survives malformed stored values", () => {
        expect(sanitizeVideoParameters([camera], null)).toEqual({});
        expect(sanitizeVideoParameters([camera], undefined)).toEqual({});
        expect(sanitizeVideoParameters([camera], "close")).toEqual({});
        expect(sanitizeVideoParameters([camera], ["close"])).toEqual({});
    });
});

describe("videoParametersForModel", () => {
    it("returns an empty object when the next model declares no parameters", () => {
        expect(videoParametersForModel([], { generate_audio: false })).toEqual({});
        expect(videoParametersForModel(undefined, { generate_audio: false })).toEqual({});
    });

    it("keeps the user value when the next model declares the same key", () => {
        expect(videoParametersForModel([generateAudio], { generate_audio: false })).toEqual({ generate_audio: false });
    });

    it("fills the next model defaults for missing values", () => {
        expect(videoParametersForModel([camera], {})).toEqual({ camera: "wide" });
        expect(videoParametersForModel([generateAudio, camera], { camera: "close" })).toEqual({ generate_audio: true, camera: "close" });
    });

    it("prefers a stored value over the model default", () => {
        expect(videoParametersForModel([generateAudio], { generate_audio: false })).toEqual({ generate_audio: false });
    });

    it("ignores definitions without a usable key", () => {
        expect(videoParametersForModel([{ key: "", label: "空", type: "text", defaultValue: "x" }], { "": "x" })).toEqual({});
    });
});