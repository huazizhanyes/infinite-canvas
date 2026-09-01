import { describe, expect, it } from "vitest";

import { appendValidCanvasConnections, canvasConnectionDropPriority, isCompatibleCanvasConnectionFromHandle, isCompatibleCanvasNodeTypes, normalizePersistedCanvasConnections, orientCanvasConnection, validateCanvasConnection } from "./canvas-connection-rules";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const node = (id: string, type = CanvasNodeType.Image): CanvasNodeData => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: {} });

describe("canvas connection rules", () => {
    const nodes = [node("a"), node("b", CanvasNodeType.Video), node("c", CanvasNodeType.Text)];

    it("accepts a directed output-to-input connection", () => {
        expect(validateCanvasConnection(nodes, [], "a", "b")).toEqual({ ok: true });
    });

    it("allows either endpoint to initiate while preserving data direction", () => {
        expect(orientCanvasConnection("image", "video", "source")).toEqual({ fromNodeId: "image", toNodeId: "video" });
        expect(orientCanvasConnection("video", "image", "target")).toEqual({ fromNodeId: "image", toNodeId: "video" });
        expect(orientCanvasConnection("image", "image", "source")).toBeNull();
    });

    it("rejects duplicate and reverse duplicate node pairs", () => {
        const connections: CanvasConnection[] = [{ id: "ab", fromNodeId: "a", toNodeId: "b" }];
        expect(validateCanvasConnection(nodes, connections, "a", "b")).toMatchObject({ ok: false, issue: "duplicate" });
        expect(validateCanvasConnection(nodes, connections, "b", "a")).toMatchObject({ ok: false, issue: "reverse-duplicate" });
    });

    it("rejects connections that create a directed cycle", () => {
        const connections: CanvasConnection[] = [
            { id: "ab", fromNodeId: "a", toNodeId: "b" },
            { id: "bc", fromNodeId: "b", toNodeId: "c" },
        ];
        expect(validateCanvasConnection(nodes, connections, "c", "a")).toMatchObject({ ok: false, issue: "cycle" });
    });

    it("rejects missing, self, and group endpoints", () => {
        expect(validateCanvasConnection(nodes, [], "a", "missing")).toMatchObject({ ok: false, issue: "missing-node" });
        expect(validateCanvasConnection(nodes, [], "a", "a")).toMatchObject({ ok: false, issue: "self" });
        expect(validateCanvasConnection([...nodes, node("group", CanvasNodeType.Group)], [], "a", "group")).toMatchObject({ ok: false, issue: "group" });
    });

    it("rejects known incompatible media input combinations", () => {
        const video = node("video", CanvasNodeType.Video);
        const image = node("image", CanvasNodeType.Image);
        expect(validateCanvasConnection([video, image], [], video.id, image.id)).toMatchObject({ ok: false, issue: "incompatible" });
        expect(validateCanvasConnection([video, image], [], image.id, video.id)).toEqual({ ok: true });
    });

    it("blocks new references from unsynced local media but preserves saved connections", () => {
        const uploading = { ...node("uploading"), metadata: { content: "blob:image", storageKey: "image:1", mediaStatus: "uploading" as const } };
        const video = node("video", CanvasNodeType.Video);
        const connection = { id: "line", fromNodeId: uploading.id, toNodeId: video.id };

        expect(validateCanvasConnection([uploading, video], [], uploading.id, video.id)).toMatchObject({ ok: false, issue: "media-not-ready" });
        expect(normalizePersistedCanvasConnections([uploading, video], [connection])).toEqual([connection]);
    });

    it("only connects extraction ownership or matching script asset types into an asset", () => {
        const extraction = node("extract", CanvasNodeType.AssetExtraction);
        const characterA = { ...node("character-a", CanvasNodeType.ScriptAsset), metadata: { scriptAssetType: "character" as const } };
        const characterB = { ...node("character-b", CanvasNodeType.ScriptAsset), metadata: { scriptAssetType: "character" as const } };
        const scene = { ...node("scene", CanvasNodeType.ScriptAsset), metadata: { scriptAssetType: "scene" as const } };
        const image = node("image", CanvasNodeType.Image);
        const graph = [extraction, characterA, characterB, scene, image];

        expect(validateCanvasConnection(graph, [], extraction.id, characterA.id)).toEqual({ ok: true });
        expect(validateCanvasConnection(graph, [], characterA.id, characterB.id)).toEqual({ ok: true });
        expect(validateCanvasConnection(graph, [], characterA.id, scene.id)).toMatchObject({ ok: false, issue: "incompatible" });
        expect(validateCanvasConnection(graph, [], image.id, characterA.id)).toMatchObject({ ok: false, issue: "incompatible" });
    });

    it("exposes the compatibility matrix used by connection creation menus", () => {
        expect(isCompatibleCanvasNodeTypes(CanvasNodeType.Image, CanvasNodeType.Video)).toBe(true);
        expect(isCompatibleCanvasNodeTypes(CanvasNodeType.Video, CanvasNodeType.Image)).toBe(false);
        expect(isCompatibleCanvasNodeTypes(CanvasNodeType.Audio, CanvasNodeType.Audio)).toBe(true);
        expect(isCompatibleCanvasNodeTypes(CanvasNodeType.Audio, CanvasNodeType.Text)).toBe(false);
    });

    it("evaluates compatibility from either initiating endpoint", () => {
        expect(isCompatibleCanvasConnectionFromHandle(CanvasNodeType.Video, CanvasNodeType.Image, "target")).toBe(true);
        expect(isCompatibleCanvasConnectionFromHandle(CanvasNodeType.Video, CanvasNodeType.Image, "source")).toBe(false);
    });

    it("normalizes legacy graphs in persisted order without reversing edges", () => {
        const legacy: CanvasConnection[] = [
            { id: "ab", fromNodeId: "a", toNodeId: "b" },
            { id: "ba", fromNodeId: "b", toNodeId: "a" },
            { id: "bc", fromNodeId: "b", toNodeId: "c" },
            { id: "ca", fromNodeId: "c", toNodeId: "a" },
        ];
        expect(normalizePersistedCanvasConnections(nodes, legacy).map((connection) => connection.id)).toEqual(["ab", "bc"]);
    });

    it("preserves a legacy incompatible direction instead of silently deleting it", () => {
        const legacyNodes = [node("video", CanvasNodeType.Video), node("image", CanvasNodeType.Image)];
        const legacy = [{ id: "legacy", fromNodeId: "video", toNodeId: "image" }];
        expect(normalizePersistedCanvasConnections(legacyNodes, legacy)).toEqual(legacy);
    });

    it("validates candidate batches incrementally", () => {
        const result = appendValidCanvasConnections(nodes, [], [
            { id: "ab", fromNodeId: "a", toNodeId: "b" },
            { id: "ba", fromNodeId: "b", toNodeId: "a" },
            { id: "ac", fromNodeId: "a", toNodeId: "c" },
        ]);
        expect(result.map((connection) => connection.id)).toEqual(["ab", "ac"]);
    });

    it("treats the full card and its nearby padding as connection drop targets", () => {
        const target = { ...node("target"), position: { x: 100, y: 200 }, width: 300, height: 180 };
        const anchor = { x: 100, y: 290 };
        expect(canvasConnectionDropPriority(target, { x: 250, y: 240 }, anchor, 1)).not.toBeNull();
        expect(canvasConnectionDropPriority(target, { x: 88, y: 240 }, anchor, 1)).not.toBeNull();
        expect(canvasConnectionDropPriority(target, { x: 20, y: 240 }, anchor, 1)).toBeNull();
        expect(canvasConnectionDropPriority(target, anchor, anchor, 1)).toBeLessThan(canvasConnectionDropPriority(target, { x: 250, y: 240 }, anchor, 1)!);
    });
});
