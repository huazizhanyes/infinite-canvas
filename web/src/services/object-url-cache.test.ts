import { afterEach, describe, expect, it, vi } from "vitest";

import { cacheObjectUrl, revokeCachedObjectUrl } from "@/services/object-url-cache";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("object URL cache", () => {
    it("revokes the previous URL when the same key is replaced", () => {
        const createObjectURL = vi.fn().mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
        const revokeObjectURL = vi.fn();
        vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
        const cache = new Map<string, string>();

        expect(cacheObjectUrl(cache, "image:1", new Blob(["first"]))).toBe("blob:first");
        expect(cacheObjectUrl(cache, "image:1", new Blob(["second"]))).toBe("blob:second");
        expect(revokeObjectURL).toHaveBeenCalledOnce();
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
    });

    it("makes repeated deletion idempotent", () => {
        const revokeObjectURL = vi.fn();
        vi.stubGlobal("URL", { createObjectURL: vi.fn(), revokeObjectURL });
        const cache = new Map([["file:1", "blob:file"]]);

        revokeCachedObjectUrl(cache, "file:1");
        revokeCachedObjectUrl(cache, "file:1");
        expect(revokeObjectURL).toHaveBeenCalledTimes(1);
        expect(cache.has("file:1")).toBe(false);
    });
});
