import type { AiTextMessage } from "@/services/api/image";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { getGenerationResourceNodes } from "@/lib/canvas/canvas-resource-references";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { CanvasGraphIndex } from "@/lib/canvas/canvas-graph-index";
import { getNodeDefinition } from "@/lib/canvas/node-registry";

export type NodeGenerationContext = {
    prompt: string;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
};

export type NodeGenerationInput = {
    nodeId: string;
    type: "text" | "image" | "video" | "audio";
    title: string;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
};

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string, mentionReferences: CanvasResourceReference[] = []): NodeGenerationContext {
    const inputs = [
        ...buildNodeGenerationInputs(nodeId, nodes, connections),
        ...buildMentionGenerationInputs(prompt, mentionReferences),
    ].filter((input, index, all) => all.findIndex((candidate) => candidate.nodeId === input.nodeId) === index);
    // An uploaded audio node doubles as the reference and the source of the generated child.
    // It has no connection yet, so include it explicitly without reusing generated TTS output.
    const targetNode = nodes.find((node) => node.id === nodeId);
    if (targetNode?.type === CanvasNodeType.Audio && targetNode.metadata?.content && targetNode.metadata.sourceType !== "tts" && !inputs.some((input) => input.type === "audio")) {
        const audio = readReferenceAudio(targetNode);
        if (audio) inputs.push({ nodeId: targetNode.id, type: "audio", title: targetNode.title, audio });
    }
    const upstreamText = inputs
        .map((input) => input.text)
        .filter(Boolean)
        .join("\n\n");
    const referenceImages = inputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = inputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = inputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: upstreamText ? `${prompt}\n\n${upstreamText}` : prompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

function buildMentionGenerationInputs(prompt: string, references: CanvasResourceReference[]): NodeGenerationInput[] {
    return references
        .map((reference, index) => ({ reference, index, position: mentionPosition(prompt, reference.label) }))
        .filter(({ reference, position }) => reference.active && reference.source === "user-asset" && position >= 0)
        .sort((left, right) => left.position - right.position || left.index - right.index)
        .flatMap(({ reference }): NodeGenerationInput[] => {
            if (reference.kind === "image") {
                return [{
                    nodeId: reference.nodeId,
                    type: "image",
                    title: reference.title,
                    image: {
                        id: reference.assetId || reference.id,
                        name: `${reference.title || reference.label}.png`,
                        type: reference.mimeType || "image/png",
                        dataUrl: reference.previewUrl || "",
                        storageKey: reference.storageKey,
                    },
                }];
            }
            if (reference.kind === "video") {
                return [{
                    nodeId: reference.nodeId,
                    type: "video",
                    title: reference.title,
                    video: {
                        id: reference.assetId || reference.id,
                        name: `${reference.title || reference.label}.mp4`,
                        type: reference.mimeType || "video/mp4",
                        url: reference.previewUrl || "",
                        storageKey: reference.storageKey,
                        bytes: reference.bytes,
                        width: reference.width,
                        height: reference.height,
                        durationMs: reference.durationMs,
                    },
                }];
            }
            return [];
        });
}

function mentionPosition(prompt: string, label: string) {
    const markedPosition = prompt.indexOf(`@${label}`);
    return markedPosition >= 0 ? markedPosition : prompt.indexOf(label);
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], graphIndex?: CanvasGraphIndex): NodeGenerationInput[] {
    return getGenerationResourceNodes(nodeId, nodes, connections, graphIndex).flatMap((node): NodeGenerationInput[] => {
        const image = readReferenceImage(node);
        if (image) return [{ nodeId: node.id, type: "image" as const, title: node.title, image }];
        const video = readReferenceVideo(node);
        if (video) return [{ nodeId: node.id, type: "video" as const, title: node.title, video }];
        const audio = readReferenceAudio(node);
        if (audio) return [{ nodeId: node.id, type: "audio" as const, title: node.title, audio }];
        const text = readNodeTextInput(node);
        if (text) return [{ nodeId: node.id, type: "text" as const, title: node.title, text }];
        return [];
    });
}

export function buildNodeResponseMessages(context: NodeGenerationContext): AiTextMessage[] {
    if (!context.referenceImages.length) {
        return [{ role: "user", content: context.prompt }];
    }

    return [
        {
            role: "user",
            content: [{ type: "text" as const, text: context.prompt }, ...context.referenceImages.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } }))],
        },
    ];
}

export async function hydrateNodeGenerationContext(context: NodeGenerationContext) {
    const { imageToDataUrl } = await import("@/services/image-storage");
    return { ...context, referenceImages: await Promise.all(context.referenceImages.map(async (image) => ({ ...image, dataUrl: await imageToDataUrl(image) }))) };
}

function readNodeTextInput(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return node.metadata?.prompt || "";
}

function readReferenceImage(node: CanvasNodeData): ReferenceImage | null {
    if (!node.metadata?.content) return null;
    const resourceKind = node.type === CanvasNodeType.Image || node.type === CanvasNodeType.ScriptAsset ? "image" : getNodeDefinition(node.type)?.resource?.(node)?.kind;
    if (resourceKind !== "image") return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.png`,
        type: node.metadata.mimeType || "image/png",
        dataUrl: node.metadata.content,
        storageKey: node.metadata.storageKey,
    };
}

function readReferenceVideo(node: CanvasNodeData): ReferenceVideo | null {
    if (node.type !== CanvasNodeType.Video || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp4`,
        type: node.metadata.mimeType || "video/mp4",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        bytes: node.metadata.bytes,
        width: node.metadata.naturalWidth,
        height: node.metadata.naturalHeight,
        durationMs: node.metadata.durationMs,
    };
}

function readReferenceAudio(node: CanvasNodeData): ReferenceAudio | null {
    if (node.type !== CanvasNodeType.Audio || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: node.title || `${node.id}.mp3`,
        type: node.metadata.mimeType || "audio/mpeg",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        mediaId: node.metadata.mediaId,
        durationMs: node.metadata.durationMs,
    };
}
