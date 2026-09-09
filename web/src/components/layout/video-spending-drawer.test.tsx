import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SpendingRow } from "./video-spending-drawer";
import type { CanvasVideoLedgerRow } from "@/services/api/canvas-billing";

const row = (patch: Partial<CanvasVideoLedgerRow> = {}): CanvasVideoLedgerRow => ({
    taskId: "task-1",
    clientRequestId: "request-1",
    status: "completed",
    publicStatus: "completed",
    model: "seedance-2.0",
    modelDisplayName: "视频模型",
    mode: "image2video",
    aspectRatio: "16:9",
    quality: "720p",
    duration: 5,
    billingStatus: "settled",
    quotedAmountMicros: "1000000",
    chargedAmountMicros: "1000000",
    createdAt: "2026-09-08T00:00:00Z",
    ...patch,
});

describe("video spending result preview", () => {
    it("renders the archived result for a completed ledger row", () => {
        const markup = renderToStaticMarkup(<SpendingRow row={row({ resultUrl: "https://cdn.example/video/task-1.mp4" })} index={0} />);
        expect(markup).toContain("<video");
        expect(markup).toContain("https://cdn.example/video/task-1.mp4");
        expect(markup).toContain("controls");
    });

    it("does not render a player for a failed task", () => {
        const markup = renderToStaticMarkup(<SpendingRow row={row({ status: "failed", publicStatus: "failed", resultUrl: null, error: { code: "UPSTREAM_FAILED", message: "生成失败" } })} index={0} />);
        expect(markup).not.toContain("<video");
        expect(markup).toContain("生成失败");
    });
});

