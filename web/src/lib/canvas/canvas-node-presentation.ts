export function canvasNodeStackClass(isGroup: boolean, isConnectionTarget: boolean, showPanel: boolean) {
    if (isGroup) return "z-[5]";
    if (isConnectionTarget) return "z-[60]";
    if (showPanel) return "z-50";
    return "z-10";
}
