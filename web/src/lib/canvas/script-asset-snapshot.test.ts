import { describe, expect, it } from "vitest";

import { createScriptAssetImageSnapshot, inheritedScriptAssetImageMetadata } from "./script-asset-snapshot";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function assetNode(metadata: CanvasNodeData["metadata"]): CanvasNodeData {
    return { id: "asset-1", type: CanvasNodeType.ScriptAsset, title: "林夏", position: { x: 0, y: 0 }, width: 560, height: 320, metadata };
}

describe("script asset snapshot", () => {
    it("captures stable source media without retaining a live metadata reference", () => {
        const source = assetNode({ scriptAssetId: "character-1", scriptAssetType: "character", scriptAssetImageId: "image-1", content: "blob:preview", storageKey: "image:u1:stable", mediaId: "media-1", naturalWidth: 1024, naturalHeight: 576, mimeType: "image/png" });
        const snapshot = createScriptAssetImageSnapshot(source, 123);
        source.metadata!.content = "blob:changed";

        expect(snapshot).toEqual(expect.objectContaining({ sourceNodeId: "asset-1", sourceAssetId: "character-1", sourceImageUrl: "blob:preview", sourceStorageKey: "image:u1:stable", sourceMediaId: "media-1", capturedAt: 123 }));
    });

    it("rejects a transient blob URL without a stable media reference", () => {
        expect(createScriptAssetImageSnapshot(assetNode({ scriptAssetType: "character", content: "blob:temporary" }))).toBeNull();
    });

    it("builds inherited image metadata without changing the snapshot", () => {
        const snapshot = createScriptAssetImageSnapshot(assetNode({ scriptAssetType: "character", content: "data:image/png;base64,AA==", naturalWidth: 10, naturalHeight: 20 }), 123)!;
        expect(inheritedScriptAssetImageMetadata(snapshot, "blob:resolved")).toMatchObject({ content: "blob:resolved", naturalWidth: 10, naturalHeight: 20, scriptAssetImageStatus: "success", scriptAssetImageOrigin: "inherited" });
        expect(snapshot.sourceImageUrl).toBe("data:image/png;base64,AA==");
    });
});
