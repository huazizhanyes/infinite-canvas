import type { CanvasNodeMetadata } from "@/types/canvas";

export const SCRIPT_SET_COLLAPSED_SIZE = { width: 360, height: 210 } as const;
export const SCRIPT_SET_EXPANDED_SIZE = { width: 920, height: 700 } as const;

export function isScriptSetExpanded(metadata: CanvasNodeMetadata | undefined, width: number, height: number) {
    if (typeof metadata?.scriptSetExpanded === "boolean") return metadata.scriptSetExpanded;
    return width >= SCRIPT_SET_EXPANDED_SIZE.width || height >= SCRIPT_SET_EXPANDED_SIZE.height;
}
