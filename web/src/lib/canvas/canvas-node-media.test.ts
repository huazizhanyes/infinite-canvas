import { beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

const mocks = vi.hoisted(() => ({
    getMediaBlob: vi.fn(),
    resolveMediaUrl: vi.fn(),
    resolvePersistedMediaUrl: vi.fn(),
    resolvePersistedImage: vi.fn(),
    storeImageLocally: vi.fn(),
}));

vi.mock("@/services/file-storage", () => ({
    getMediaBlob: mocks.getMediaBlob,
    resolveMediaUrl: mocks.resolveMediaUrl,
    resolvePersistedMediaUrl: mocks.resolvePersistedMediaUrl,
}));
vi.mock("@/services/image-storage", () => ({
    resolvePersistedImage: mocks.resolvePersistedImage,
    storeImageLocally: mocks.storeImageLocally,
}));

import { hasFailedMediaReference, hydrateCanvasNodes } from "./canvas-node-media";

function reference(patch: Partial<CanvasResourceReference>): CanvasResourceReference {
    return { id: "ref", nodeId: "node", kind: "image", label: "图片1", title: "参考图", active: true, ...patch };
}

function node(id: string, type: CanvasNodeType, metadata: CanvasNodeData["metadata"]): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata };
}

describe("canvas node media hydration", () => {
    beforeEach(() => {
        mocks.getMediaBlob.mockReset().mockResolvedValue(null);
        mocks.resolveMediaUrl.mockReset().mockResolvedValue("");
        mocks.resolvePersistedMediaUrl.mockReset().mockResolvedValue("");
        mocks.resolvePersistedImage.mockReset().mockResolvedValue({ url: "", storageKey: undefined });
        mocks.storeImageLocally.mockReset();
    });

    it("keeps one broken reference from failing the whole canvas", async () => {
        mocks.resolvePersistedMediaUrl.mockResolvedValue("https://cdn.example/ok.mp4");
        mocks.resolvePersistedImage.mockResolvedValue({ url: "", storageKey: undefined });

        const broken = node("image-broken", CanvasNodeType.Image, { mediaId: "media-broken", content: "" });
        const healthy = node("video-ok", CanvasNodeType.Video, { mediaId: "media-ok", content: "" });

        const result = await hydrateCanvasNodes([broken, healthy]);

        expect(result.failedNodeIds).toEqual(new Set(["image-broken"]));
        expect(result.nodes[0]).toBe(broken);
        expect(result.nodes[1].metadata?.content).toBe("https://cdn.example/ok.mp4");
    });

    it("still restores every healthy node when a sibling fails", async () => {
        mocks.resolvePersistedImage.mockResolvedValue({ url: "https://cdn.example/old.png", storageKey: "image:u1:media-ok" });

        const broken = node("video-broken", CanvasNodeType.Video, { storageKey: "video:u1:gone" });
        const healthy = node("image-ok", CanvasNodeType.Image, { mediaId: "media-ok", content: "" });

        const result = await hydrateCanvasNodes([broken, healthy]);

        expect(result.failedNodeIds).toEqual(new Set(["video-broken"]));
        expect(result.nodes[0]).toBe(broken);
        expect(result.nodes[1].metadata).toMatchObject({ content: "https://cdn.example/old.png", storageKey: "image:u1:media-ok" });
    });

    it("reports no failure when every node resolves", async () => {
        mocks.getMediaBlob.mockResolvedValue(new Blob(["video"], { type: "video/mp4" }));
        mocks.resolveMediaUrl.mockResolvedValue("blob:local-video");

        const video = node("video-local", CanvasNodeType.Video, { storageKey: "video:u1:local", content: "" });

        const result = await hydrateCanvasNodes([video]);

        expect(result.failedNodeIds.size).toBe(0);
        expect(result.nodes[0].metadata).toMatchObject({ content: "blob:local-video", storageKey: "video:u1:local" });
    });

    it("uses the delegated resolver when the built-in resolution fails", async () => {
        mocks.resolvePersistedImage.mockResolvedValue({ url: "", storageKey: undefined });
        const resolveMediaUrl = vi.fn().mockResolvedValue("https://admin.example/media.png");

        const broken = node("image-broken", CanvasNodeType.Image, { mediaId: "media-broken", content: "" });
        const result = await hydrateCanvasNodes([broken], { resolveMediaUrl });

        expect(resolveMediaUrl).toHaveBeenCalledWith("media-broken");
        expect(result.failedNodeIds.size).toBe(0);
        expect(result.nodes[0].metadata?.content).toBe("https://admin.example/media.png");
    });

    it("delegates video media resolution for debug copies", async () => {
        const resolveMediaUrl = vi.fn().mockResolvedValue("https://admin.example/clip.mp4");

        const video = node("video-1", CanvasNodeType.Video, { mediaId: "media-video", content: "" });
        const result = await hydrateCanvasNodes([video], { resolveMediaUrl });

        expect(result.failedNodeIds.size).toBe(0);
        expect(result.nodes[0].metadata?.content).toBe("https://admin.example/clip.mp4");
    });

    it("still records a failure when the delegated resolver has nothing", async () => {
        mocks.resolvePersistedImage.mockResolvedValue({ url: "", storageKey: undefined });
        const resolveMediaUrl = vi.fn().mockResolvedValue("");

        const broken = node("image-broken", CanvasNodeType.Image, { mediaId: "media-broken", content: "" });
        const result = await hydrateCanvasNodes([broken], { resolveMediaUrl });

        expect(result.failedNodeIds).toEqual(new Set(["image-broken"]));
        expect(result.nodes[0]).toBe(broken);
    });

    it("only blocks a node on references that are actually connected", () => {
        const failed = new Set(["image-broken"]);

        expect(hasFailedMediaReference([reference({ nodeId: "image-broken" })], failed)).toBe(true);
        expect(hasFailedMediaReference([reference({ nodeId: "image-broken", active: false })], failed)).toBe(false);
        expect(hasFailedMediaReference([reference({ nodeId: "image-broken", source: "user-asset" })], failed)).toBe(false);
        expect(hasFailedMediaReference([reference({ nodeId: "image-ok" })], failed)).toBe(false);
        expect(hasFailedMediaReference([reference({ nodeId: "image-broken" })], new Set())).toBe(false);
        expect(hasFailedMediaReference([reference({ nodeId: "image-broken", previewUrl: "https://cdn.example/restored.png" })], failed)).toBe(false);
    });

    it("keeps syncing a batch root from its first resolvable child", async () => {
        mocks.resolvePersistedImage.mockImplementation(async (mediaId: string) => (
            mediaId === "media-a" ? { url: "", storageKey: undefined } : { url: "https://cdn.example/b.png", storageKey: "image:u1:media-b" }
        ));

        const brokenChild = node("child-a", CanvasNodeType.Image, { mediaId: "media-a", content: "" });
        const healthyChild = node("child-b", CanvasNodeType.Image, { mediaId: "media-b", content: "" });
        const root = node("root", CanvasNodeType.Image, { isBatchRoot: true, batchChildIds: ["child-a", "child-b"] });

        const result = await hydrateCanvasNodes([brokenChild, healthyChild, root]);
        const hydratedRoot = result.nodes.find((item) => item.id === "root");

        expect(result.failedNodeIds).toEqual(new Set(["child-a"]));
        expect(hydratedRoot?.metadata).toMatchObject({ primaryImageId: "child-b", content: "https://cdn.example/b.png" });
    });
});
