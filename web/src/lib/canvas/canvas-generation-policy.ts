import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export function isNonInterruptibleVideoGeneration(nodeType: CanvasNodeData["type"], isRunning: boolean) {
    return isRunning && nodeType === CanvasNodeType.Video;
}
