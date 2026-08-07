import { describe, expect, it } from "vitest";

import { createCanvasSpatialIndex } from "./canvas-spatial-index";

describe("createCanvasSpatialIndex", () => {
    const entries = [
        { bounds: { left: 0, top: 0, right: 80, bottom: 80 }, value: "first" },
        { bounds: { left: 90, top: 10, right: 240, bottom: 70 }, value: "second" },
        { bounds: { left: -150, top: -150, right: -50, bottom: -50 }, value: "third" },
    ];

    it("returns only entries that overlap the query", () => {
        const index = createCanvasSpatialIndex(entries, 100);

        expect(index.query({ left: 60, top: 0, right: 120, bottom: 100 })).toEqual(["first", "second"]);
    });

    it("deduplicates entries spanning multiple cells and keeps source order", () => {
        const index = createCanvasSpatialIndex(entries, 50);

        expect(index.query({ left: -200, top: -200, right: 300, bottom: 200 })).toEqual(["first", "second", "third"]);
    });

    it("returns an empty result when no indexed bounds overlap", () => {
        const index = createCanvasSpatialIndex(entries, 100);

        expect(index.query({ left: 500, top: 500, right: 600, bottom: 600 })).toEqual([]);
    });

    it("handles very large entries without filling every crossed cell", () => {
        const index = createCanvasSpatialIndex([
            ...entries,
            { bounds: { left: -100_000, top: 20, right: 100_000, bottom: 30 }, value: "long" },
        ], 100);

        expect(index.query({ left: 10_000, top: 0, right: 10_100, bottom: 100 })).toEqual(["long"]);
    });
});
