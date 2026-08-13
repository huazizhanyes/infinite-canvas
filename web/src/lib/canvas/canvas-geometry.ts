import type { CanvasNodeData } from "@/types/canvas";

export function sameNodeGeometry(previous: CanvasNodeData[], next: CanvasNodeData[]) {
    return previous.length === next.length && previous.every((node, index) => {
        const candidate = next[index];
        return candidate?.id === node.id
            && candidate.position.x === node.position.x
            && candidate.position.y === node.position.y
            && candidate.width === node.width
            && candidate.height === node.height;
    });
}
