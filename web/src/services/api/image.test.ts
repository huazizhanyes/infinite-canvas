import { describe, expect, it } from "vitest";

import { parseCanvasImageTaskItems } from "./image";

describe("canvas image task items", () => {
    it("keeps backend item indexes when only part of a batch has completed", () => {
        const items = parseCanvasImageTaskItems({ task_id: "task-1", status: "partial_success", data: [{ index: 1, url: "https://example.test/1.png", status: "success" }, { index: 2, url: "https://example.test/2.png", status: "success" }] });
        expect(items).toEqual([
            { index: 1, dataUrl: "https://example.test/1.png", status: "success" },
            { index: 2, dataUrl: "https://example.test/2.png", status: "success" },
        ]);
    });
});
