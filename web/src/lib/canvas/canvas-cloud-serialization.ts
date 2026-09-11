import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

const MEDIA_URL_FIELDS = ["content", "dataUrl", "url", "coverUrl"] as const;

export function serializeCanvasProjectForCloud(project: CanvasProject): CanvasProject {
    return sanitizeValue(project) as CanvasProject;
}

function sanitizeValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sanitizeValue);
    if (!value || typeof value !== "object") return value;

    const source = value as Record<string, unknown>;
    const next = Object.fromEntries(Object.entries(source).map(([key, item]) => [key, sanitizeValue(item)]));
    const mediaId = typeof source.mediaId === "string" && source.mediaId ? source.mediaId : "";
    const sourceMediaId = typeof source.sourceMediaId === "string" && source.sourceMediaId ? source.sourceMediaId : "";

    if ("storageKey" in next) delete next.storageKey;
    if ("sourceStorageKey" in next) delete next.sourceStorageKey;
    if ("debugReadOnly" in next) delete next.debugReadOnly;
    if ("debugSessionId" in next) delete next.debugSessionId;
    if ("debugSourceUserId" in next) delete next.debugSourceUserId;
    if ("debugSourceProjectId" in next) delete next.debugSourceProjectId;
    MEDIA_URL_FIELDS.forEach((field) => {
        if (field in next && (mediaId || isTemporaryUrl(next[field]))) next[field] = "";
    });
    if ("sourceImageUrl" in next && (sourceMediaId || isTemporaryUrl(next.sourceImageUrl))) next.sourceImageUrl = "";
    return next;
}

function isTemporaryUrl(value: unknown) {
    if (typeof value !== "string") return false;
    if (value.startsWith("blob:") || value.startsWith("data:")) return true;
    if (!/^https?:\/\//i.test(value)) return false;
    try {
        const params = new URL(value).searchParams;
        return ["Expires", "Signature", "OSSAccessKeyId", "x-oss-signature", "x-oss-expires", "X-Amz-Signature", "X-Amz-Expires"].some((key) => params.has(key));
    } catch {
        return false;
    }
}
