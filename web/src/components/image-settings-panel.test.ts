import { describe, expect, it } from "vitest";

import { imageAspectOptionDetails, imageAspectOptions, normalizeImageCount } from "@/lib/image-settings";

describe("image settings", () => {
    it("maps aspect ratios to concrete model sizes", () => {
        expect(imageAspectOptionDetails.find((item) => item.value === "16:9")?.size).toBe("1824x1024");
        expect(imageAspectOptions.find((item) => item.label === "1:1")?.value).toBe("1024x1024");
        expect(imageAspectOptions.find((item) => item.label === "auto")?.value).toBe("auto");
    });

    it("uses separate canvas and image-workbench count limits", () => {
        expect(normalizeImageCount(10)).toBe(5);
        expect(normalizeImageCount(10, 10)).toBe(10);
        expect(normalizeImageCount(9.7, 10)).toBe(9);
        expect(normalizeImageCount(0, 10)).toBe(1);
        expect(normalizeImageCount(-4, 10)).toBe(4);
    });
});
