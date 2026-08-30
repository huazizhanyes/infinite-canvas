import type { CanvasConnection } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export type CanvasConnectionPreview = {
    connectionId: string;
    nodeId: string;
    kind: "image" | "video" | "audio";
    label: string;
    title: string;
    previewUrl?: string;
};

export function buildCanvasConnectionPreviews(nodeId: string, connections: CanvasConnection[], references: CanvasResourceReference[]) {
    const connectionByNodeId = new Map<string, CanvasConnection>();
    connections.forEach((connection) => {
        if (connection.toNodeId === nodeId) connectionByNodeId.set(connection.fromNodeId, connection);
    });

    return references.flatMap((reference): CanvasConnectionPreview[] => {
        if (reference.source !== "canvas" || !reference.active || (reference.kind !== "image" && reference.kind !== "video" && reference.kind !== "audio")) return [];
        if (reference.kind !== "audio" && !reference.previewUrl) return [];
        const connection = connectionByNodeId.get(reference.nodeId);
        if (!connection) return [];
        return [{
            connectionId: connection.id,
            nodeId: reference.nodeId,
            kind: reference.kind,
            label: reference.label,
            title: reference.title,
            previewUrl: reference.previewUrl,
        }];
    });
}

export function appendCanvasConnectionMention(prompt: string, label: string) {
    const token = `@${label}`;
    if (mentionPattern(label).test(prompt)) return prompt;
    if (!prompt) return `${token} `;
    return `${prompt}${/\s$/.test(prompt) ? "" : " "}${token} `;
}

export function removeCanvasConnectionMention(prompt: string | undefined, label: string) {
    if (!prompt) return prompt || "";
    return prompt
        .replace(mentionPattern(label), "")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n[ \t]+/g, "\n")
        .trim();
}

function mentionPattern(label: string) {
    return new RegExp(`${escapeRegExp(`@${label}`)}(?!\\d)`, "g");
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
