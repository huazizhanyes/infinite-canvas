import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type ScriptAssetImageSnapshot } from "@/types/canvas";

export function createScriptAssetImageSnapshot(source: CanvasNodeData, capturedAt = Date.now()): ScriptAssetImageSnapshot | null {
    const metadata = source.metadata;
    const sourceType = metadata?.scriptAssetType;
    const sourceImageUrl = metadata?.content || "";
    const hasStableReference = Boolean(metadata?.storageKey || metadata?.mediaId || sourceImageUrl.startsWith("data:"));
    if (source.type !== CanvasNodeType.ScriptAsset || !sourceType || !sourceImageUrl || !hasStableReference) return null;
    return {
        sourceNodeId: source.id,
        sourceAssetId: metadata.scriptAssetId,
        sourceImageId: metadata.scriptAssetImageId,
        sourceStorageKey: metadata.storageKey,
        sourceMediaId: metadata.mediaId,
        sourceImageUrl,
        sourceTitle: source.title,
        sourceType,
        mimeType: metadata.mimeType,
        width: metadata.naturalWidth,
        height: metadata.naturalHeight,
        bytes: metadata.bytes,
        capturedAt,
    };
}

export function inheritedScriptAssetImageMetadata(snapshot: ScriptAssetImageSnapshot, content = snapshot.sourceImageUrl): CanvasNodeMetadata {
    return {
        content,
        storageKey: snapshot.sourceStorageKey,
        mediaId: snapshot.sourceMediaId,
        mediaStatus: snapshot.sourceMediaId ? "synced" : snapshot.sourceStorageKey ? "uploading" : undefined,
        naturalWidth: snapshot.width,
        naturalHeight: snapshot.height,
        bytes: snapshot.bytes,
        mimeType: snapshot.mimeType,
        scriptAssetImageStatus: "success",
        scriptAssetImageOrigin: "inherited",
        errorDetails: undefined,
    };
}
