import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("antd", () => ({ App: { useApp: () => ({ modal: { confirm: vi.fn() } }) } }));

import { decideUpdateAction, probeAppVersion, readPostponeRecord, writePostponeRecord } from "./use-app-update-check";

function stubSessionStorage() {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
        sessionStorage: {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => { store.set(key, value); },
            removeItem: (key: string) => { store.delete(key); },
        },
    });
    return store;
}

describe("app update check", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("reads the build id from the same-origin version file", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ version: "1.0.0", buildId: " 1789003502604 " }), { status: 200 })));

        await expect(probeAppVersion()).resolves.toEqual({ buildId: "1789003502604", missing: false });
    });

    it("disables polling when the deployment has no version file", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));

        await expect(probeAppVersion()).resolves.toEqual({ buildId: "", missing: true });
    });

    it("keeps polling after a transient failure", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));

        await expect(probeAppVersion()).resolves.toEqual({ buildId: "", missing: false });
    });

    it("only prompts when the build id changes after the page was opened", () => {
        const now = Date.now();

        expect(decideUpdateAction({ baseline: "", latest: "1", now })).toBe("baseline");
        expect(decideUpdateAction({ baseline: "1", latest: "1", now })).toBe("skip");
        expect(decideUpdateAction({ baseline: "1", latest: "2", now })).toBe("prompt");
        expect(decideUpdateAction({ baseline: "1", latest: "", now })).toBe("skip");
    });

    it("respects the postpone window for the same build id", () => {
        const now = Date.now();

        expect(decideUpdateAction({ baseline: "1", latest: "2", postponed: { buildId: "2", at: now - 60 * 1000 }, now })).toBe("skip");
        expect(decideUpdateAction({ baseline: "1", latest: "2", postponed: { buildId: "2", at: now - 31 * 60 * 1000 }, now })).toBe("prompt");
        expect(decideUpdateAction({ baseline: "1", latest: "3", postponed: { buildId: "2", at: now - 60 * 1000 }, now })).toBe("prompt");
    });

    it("stores and reads the postpone record", () => {
        stubSessionStorage();

        expect(readPostponeRecord()).toBeNull();
        writePostponeRecord("build-2", 1700000000000);
        expect(readPostponeRecord()).toEqual({ buildId: "build-2", at: 1700000000000 });
        writePostponeRecord("");
        expect(readPostponeRecord()).toBeNull();
    });
});
