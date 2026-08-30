import { describe, expect, it } from "vitest";

import { fitMediaInsideNode } from "@/lib/canvas/canvas-node-size";

describe("fitMediaInsideNode", () => {
    it("removes horizontal letterboxing while preserving the media ratio", () => {
        expect(fitMediaInsideNode(1080, 1080, 420, 236)).toEqual({ width: 236, height: 236 });
    });

    it("removes vertical letterboxing while preserving the media ratio", () => {
        expect(fitMediaInsideNode(1920, 1080, 320, 320)).toEqual({ width: 320, height: 180 });
    });
});
