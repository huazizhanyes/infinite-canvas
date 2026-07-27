import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, Blob>());

vi.mock("localforage", () => ({
    default: {
        createInstance: () => ({
            getItem: async (key: string) => storage.get(key) ?? null,
            setItem: async (key: string, value: Blob) => {
                storage.set(key, value);
                return value;
            },
            removeItem: async (key: string) => {
                storage.delete(key);
            },
            iterate: async (iterator: (value: Blob, key: string, index: number) => void) => {
                Array.from(storage.entries()).forEach(([key, value], index) => iterator(value, key, index));
            },
        }),
    },
}));

import { cleanupUnusedMedia, deleteStoredMedia, setMediaBlob } from "@/services/file-storage";

describe("media storage lifecycle", () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>();
    const revokeObjectURL = vi.fn<(url: string) => void>();

    beforeEach(async () => {
        await deleteStoredMedia(storage.keys());
        storage.clear();
        createObjectURL.mockReset();
        revokeObjectURL.mockReset();
        vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    });

    it("revokes the old URL when replacing a blob and makes deletion idempotent", async () => {
        createObjectURL.mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");

        await setMediaBlob("file:replace", new Blob(["first"]));
        await setMediaBlob("file:replace", new Blob(["second"]));
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");

        await deleteStoredMedia(["file:replace"]);
        await deleteStoredMedia(["file:replace"]);
        expect(storage.has("file:replace")).toBe(false);
        expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual(["blob:first", "blob:second"]);
    });

    it("cleans unused blobs while preserving referenced media across repeated calls", async () => {
        createObjectURL.mockReturnValueOnce("blob:used").mockReturnValueOnce("blob:unused");
        await setMediaBlob("file:used", new Blob(["used"]));
        await setMediaBlob("file:unused", new Blob(["unused"]));

        await cleanupUnusedMedia({ currentProject: { storageKey: "file:used" } });
        await cleanupUnusedMedia({ currentProject: { storageKey: "file:used" } });

        expect(storage.has("file:used")).toBe(true);
        expect(storage.has("file:unused")).toBe(false);
        expect(revokeObjectURL).toHaveBeenCalledTimes(1);
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:unused");
    });
});
