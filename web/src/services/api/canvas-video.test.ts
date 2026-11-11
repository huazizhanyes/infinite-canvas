import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";

import { canvasVideoResult, readCanvasVideoError } from "./canvas-video";

const axiosError = (status: number, data: unknown) => new AxiosError(
    `Request failed with status code ${status}`,
    String(status),
    undefined,
    undefined,
    { status, statusText: "", data, headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } },
);

describe("canvas video task results", () => {
    it("does not surface the framework's generic 500 body as a node error", () => {
        expect(readCanvasVideoError(axiosError(500, { statusCode: 500, message: "Internal server error" }), "视频任务创建失败"))
            .toBe("视频服务暂时不可用，请稍后重试");
        expect(readCanvasVideoError(axiosError(503, { message: "Service Unavailable" }), "视频任务创建失败"))
            .toBe("视频服务暂时不可用，请稍后重试");
    });

    it("keeps a meaningful server message", () => {
        expect(readCanvasVideoError(axiosError(500, { message: "上游数据库连接失败" }), "视频任务创建失败"))
            .toBe("上游数据库连接失败");
        expect(readCanvasVideoError(axiosError(409, { message: "报价预占已释放，请重新获取报价后重试" }), "视频任务创建失败"))
            .toBe("报价预占已释放，请重新获取报价后重试");
    });

    it("falls back to the caller's message for network failures", () => {
        expect(readCanvasVideoError(new AxiosError("timeout of 30000ms exceeded", "ECONNABORTED"), "视频任务创建失败"))
            .toBe("timeout of 30000ms exceeded");
    });

    it("keeps the server URL and storage key without creating a browser media key", () => {
        const result = canvasVideoResult({
            id: "task-1",
            clientRequestId: "request-1",
            status: "completed",
            progress: 100,
            projectId: "project-1",
            nodeId: "node-1",
            modelId: "12::seedance-2.0",
            mode: "text2video",
            aspectRatio: "16:9",
            quality: "720p",
            duration: 5,
            resultUrl: "https://media.example.test/flash-api/canvas-video-files/generated/video.mp4",
            serverStorageKey: "generated/2026/07/u1/random-video.mp4",
            storageType: "local",
            mimeType: "video/mp4",
            width: 1280,
            height: 720,
        });

        expect(result.url).toMatch(/^https:\/\//);
        expect(result.storageKey).toBe("generated/2026/07/u1/random-video.mp4");
        expect(result.storageKey).not.toMatch(/^video:/);
        expect(result.durationMs).toBe(5000);
        expect(result.clientRequestId).toBe("request-1");
    });
});
