export function fitNodeSize(width: number, height: number, maxWidth = 640, maxHeight = 640) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const scale = Math.min(1, maxWidth / w, maxHeight / h);
    return { width: w * scale, height: h * scale };
}

/** Shrink a node box to the exact visible media bounds without cropping or stretching. */
export function fitMediaInsideNode(mediaWidth: number, mediaHeight: number, nodeWidth: number, nodeHeight: number) {
    const width = Math.max(1, mediaWidth);
    const height = Math.max(1, mediaHeight);
    const scale = Math.min(Math.max(1, nodeWidth) / width, Math.max(1, nodeHeight) / height);
    return { width: width * scale, height: height * scale };
}

export function nodeSizeFromRatio(size: string, baseWidth: number, baseHeight: number) {
    const match = size?.match(/^(\d+)(?:x|:)(\d+)/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    const ratio = width / Math.max(1, height);
    if (ratio < 0.25 || ratio > 4) return { width: baseWidth, height: baseHeight };
    return ratio >= baseWidth / baseHeight ? { width: baseWidth, height: baseWidth / ratio } : { width: baseHeight * ratio, height: baseHeight };
}
