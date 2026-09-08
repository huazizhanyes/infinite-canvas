import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export function isNonInterruptibleVideoGeneration(nodeType: CanvasNodeData["type"], isRunning: boolean) {
    return isRunning && nodeType === CanvasNodeType.Video;
}

export function videoModelSelectionPatch(model: string, quality?: string, seconds = "5") {
    return { model, seconds, ...(quality ? { vquality: quality } : {}) };
}
