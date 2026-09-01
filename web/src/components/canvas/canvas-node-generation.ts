import type { AiTextMessage } from "@/services/api/image";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { getGenerationResourceNodes, mentionedCanvasResourceReferences, missingCanvasResourceMentions, plainCanvasResourceMentions, resolveCanvasResourceMentionLabels } from "@/lib/canvas/canvas-resource-references";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { CanvasGraphIndex } from "@/lib/canvas/canvas-graph-index";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";

export type NodeGenerationContext = {
    prompt: string;
    submissionPrompt: string;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
    selectedReferenceNodeIds: string[];
    ignoredReferenceLabels: string[];
    referenceLabelMapping: Record<string, string>;
};

export type NodeGenerationInput = {
    nodeId: string;
    type: "text" | "image" | "video" | "audio";
    title: string;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
    label?: string;
};

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string, mentionReferences: CanvasResourceReference[] = []): NodeGenerationContext {
    const targetNode = nodes.find((node) => node.id === nodeId);
    const labelByNodeId = new Map(mentionReferences.map((reference) => [reference.nodeId, reference.label]));
    const mentionedCanvasReferences = mentionedCanvasResourceReferences(prompt, mentionReferences);
    const mentionedCanvasIds = new Set(mentionedCanvasReferences.map((reference) => reference.nodeId));
    const connectedInputs = buildNodeGenerationInputs(nodeId, nodes, connections).map((input) => ({ ...input, label: labelByNodeId.get(input.nodeId) }));
    const selectedConnectedInputs = targetNode?.type === CanvasNodeType.Video
        ? connectedInputs.filter((input) => (input.type !== "image" && input.type !== "video") || mentionedCanvasIds.has(input.nodeId))
        : connectedInputs;
    const inputs = [
        ...selectedConnectedInputs,
        ...buildMentionGenerationInputs(prompt, mentionReferences),
    ].filter((input, index, all) => all.findIndex((candidate) => candidate.nodeId === input.nodeId) === index);
    // An uploaded audio node doubles as the reference and the source of the generated child.
    // It has no connection yet, so include it explicitly without reusing generated TTS output.
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
    const submission = targetNode?.type === CanvasNodeType.Video ? buildVideoSubmissionPrompt(prompt, inputs, mentionReferences) : { prompt, selectedNodeIds: [], ignoredLabels: [], labelMapping: {} };
    const plainPrompt = plainCanvasResourceMentions(prompt);

    return {
        prompt: upstreamText ? `${plainPrompt}\n\n${upstreamText}` : plainPrompt,
        submissionPrompt: upstreamText ? `${submission.prompt}\n\n${upstreamText}` : submission.prompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
        selectedReferenceNodeIds: submission.selectedNodeIds,
        ignoredReferenceLabels: submission.ignoredLabels,
        referenceLabelMapping: submission.labelMapping,
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
                        ...(reference.mediaId ? { mediaId: reference.mediaId } : {}),
                    },
                    label: reference.label,
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
                        ...(reference.mediaId ? { mediaId: reference.mediaId } : {}),
                        bytes: reference.bytes,
                        width: reference.width,
                        height: reference.height,
                        durationMs: reference.durationMs,
                    },
                    label: reference.label,
                }];
            }
            return [];
        });
}

function buildVideoSubmissionPrompt(prompt: string, inputs: NodeGenerationInput[], references: CanvasResourceReference[]) {
    const imageInputs = inputs.filter((input) => input.type === "image" && input.image);
    const selectedNodeIds = imageInputs.map((input) => input.nodeId);
    const labelMapping: Record<string, string> = {};
    imageInputs.forEach((input, index) => {
        const label = input.label || references.find((reference) => reference.nodeId === input.nodeId)?.label;
        if (label) labelMapping[label] = imageReferenceLabel(index);
    });
    const ignoredLabels = mentionedCanvasResourceReferences(prompt, references)
        .filter((reference) => reference.kind !== "text" && !reference.active)
        .map((reference) => reference.label);
    ignoredLabels.push(...missingCanvasResourceMentions(prompt, references).map((mention) => mention.label));
    return {
        prompt: rewriteVideoImageMentions(prompt, references, labelMapping, new Set(ignoredLabels)),
        selectedNodeIds,
        ignoredLabels,
        labelMapping,
    };
}

function rewriteVideoImageMentions(prompt: string, references: CanvasResourceReference[], labelMapping: Record<string, string>, ignoredLabels: Set<string>) {
    const byLabel = new Map(references.filter((reference) => reference.kind === "image").map((reference) => [reference.label, reference]));
    const labels = [...byLabel.keys()].sort((left, right) => right.length - left.length);
    const resolvedPrompt = resolveCanvasResourceMentionLabels(prompt, references);
    let result = "";
    for (let index = 0; index < resolvedPrompt.length;) {
        if (resolvedPrompt[index] !== "@") {
            result += resolvedPrompt[index];
            index += 1;
            continue;
        }
        const label = labels.find((candidate) => resolvedPrompt.startsWith(candidate, index + 1) && isMentionBoundary(resolvedPrompt[index + candidate.length + 1]));
        if (!label) {
            result += resolvedPrompt[index];
            index += 1;
            continue;
        }
        if (labelMapping[label]) result += `@${labelMapping[label]}`;
        else if (!ignoredLabels.has(label)) result += `@${label}`;
        index += label.length + 1;
    }
    return result.replace(/ {2,}/g, " ").trim();
}

function isMentionBoundary(value?: string) {
    return !value || !/\d/.test(value);
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

export function restoreVideoGenerationSnapshot(
    context: NodeGenerationContext,
    prompt: string,
    metadata: CanvasNodeData["metadata"],
    snapshotImages: ReferenceImage[],
): NodeGenerationContext {
    if (!snapshotImages.length || !metadata) return context;
    const submittedOrder = metadata.submittedReferenceOrder || [];
    const entries = Object.entries(metadata.submittedReferenceLabelMap || {})
        .map(([label, upstreamLabel]) => ({ label, index: imageLabelIndex(upstreamLabel) }))
        .filter((entry) => entry.index >= 0 && entry.index < snapshotImages.length)
        .sort((left, right) => left.index - right.index);
    const mentionedEntries = entries.filter((entry) => hasReferenceMention(prompt, entry.label));

    if (!mentionedEntries.length) {
        const unchangedPrompt = prompt.trim() === String(metadata.composerContent ?? metadata.prompt ?? "").trim();
        if (context.referenceImages.length || !unchangedPrompt || !metadata.submissionPrompt) return context;
        return {
            ...context,
            submissionPrompt: metadata.submissionPrompt,
            referenceImages: snapshotImages,
            imageCount: snapshotImages.length,
            selectedReferenceNodeIds: snapshotImages.map((_, index) => submittedOrder[index] || `snapshot:${index}`),
            referenceLabelMapping: metadata.submittedReferenceLabelMap || {},
        };
    }

    const liveImages = new Map(context.selectedReferenceNodeIds.map((id, index) => [id, context.referenceImages[index]]));
    const selected = mentionedEntries.map((entry) => {
        const nodeId = submittedOrder[entry.index] || `snapshot:${entry.index}`;
        return { label: entry.label, nodeId, image: liveImages.get(nodeId) || snapshotImages[entry.index] };
    });
    const selectedIds = new Set(selected.map((entry) => entry.nodeId));
    context.selectedReferenceNodeIds.forEach((nodeId, index) => {
        if (!selectedIds.has(nodeId) && context.referenceImages[index]) selected.push({ label: "", nodeId, image: context.referenceImages[index] });
    });
    const labelMapping = Object.fromEntries(selected.map((entry, index) => entry.label ? [entry.label, imageReferenceLabel(index)] : []).filter((entry) => entry.length));
    return {
        ...context,
        submissionPrompt: rewriteSnapshotMentions(context.prompt, labelMapping),
        referenceImages: selected.map((entry) => entry.image),
        imageCount: selected.length,
        selectedReferenceNodeIds: selected.map((entry) => entry.nodeId),
        ignoredReferenceLabels: [],
        referenceLabelMapping: { ...context.referenceLabelMapping, ...labelMapping },
    };
}

function imageLabelIndex(value: string) {
    const match = /^图片(\d+)$/.exec(String(value || ""));
    return match ? Number(match[1]) - 1 : -1;
}

function hasReferenceMention(prompt: string, label: string) {
    const index = prompt.indexOf(`@${label}`);
    return index >= 0 && isMentionBoundary(prompt[index + label.length + 1]);
}

function rewriteSnapshotMentions(prompt: string, mapping: Record<string, string>) {
    return Object.keys(mapping).sort((left, right) => right.length - left.length).reduce((value, label) => (
        value.replace(new RegExp(`@${escapeRegExp(label)}(?!\\d)`, "g"), `@${mapping[label]}`)
    ), prompt);
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
        ...(node.metadata.mediaId ? { mediaId: node.metadata.mediaId } : {}),
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
        ...(node.metadata.mediaId ? { mediaId: node.metadata.mediaId } : {}),
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
