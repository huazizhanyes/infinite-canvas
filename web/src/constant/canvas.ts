import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeMetadata } from "@/types/canvas";
import { getNodeSpec as getRegistryNodeSpec } from "@/lib/canvas/node-registry";

type CanvasNodeSpec = { width: number; height: number; title: string; metadata?: CanvasNodeMetadata };

export const NODE_DEFAULT_SIZE = {
    [CanvasNodeType.Image]: { width: 340, height: 240, title: "图片" },
    [CanvasNodeType.Text]: { width: 340, height: 240, title: "文本" },
    [CanvasNodeType.Video]: { width: 420, height: 236, title: "视频" },
    [CanvasNodeType.Audio]: { width: 340, height: 120, title: "音频" },
    [CanvasNodeType.Group]: { width: 760, height: 480, title: "组" },
    [CanvasNodeType.AssetExtraction]: { width: 680, height: 560, title: "资产提取" },
    [CanvasNodeType.ScriptAsset]: { width: 560, height: 320, title: "资产" },
    [CanvasNodeType.AssetStoryboard]: { width: 300, height: 180, title: "分镜脚本" },
} satisfies Record<CanvasNodeType, { width: number; height: number; title: string }>;

export const NODE_SPECS = {
    [CanvasNodeType.Image]: { ...NODE_DEFAULT_SIZE[CanvasNodeType.Image], metadata: { content: "", status: "idle" } },
    [CanvasNodeType.Text]: { ...NODE_DEFAULT_SIZE[CanvasNodeType.Text], metadata: { content: "", status: "idle", fontSize: 13 } },
    [CanvasNodeType.Video]: { ...NODE_DEFAULT_SIZE[CanvasNodeType.Video], metadata: { content: "", status: "idle" } },
    [CanvasNodeType.Audio]: { ...NODE_DEFAULT_SIZE[CanvasNodeType.Audio], metadata: { content: "", status: "idle" } },
    [CanvasNodeType.Group]: { ...NODE_DEFAULT_SIZE[CanvasNodeType.Group], metadata: { status: "idle" } },
    [CanvasNodeType.AssetExtraction]: { ...NODE_DEFAULT_SIZE[CanvasNodeType.AssetExtraction], metadata: { status: "idle", content: "", assetExtractionRecordName: "未命名", assetExtractionStatus: "idle", assetExtractionVisualStyle: "3D漫风格", assetExtractionAspectRatio: "16:9", assetExtractionImageQuality: "standard" } },
    [CanvasNodeType.ScriptAsset]: { ...NODE_DEFAULT_SIZE[CanvasNodeType.ScriptAsset], metadata: { status: "idle", scriptAssetImageStatus: "idle" } },
    [CanvasNodeType.AssetStoryboard]: { ...NODE_DEFAULT_SIZE[CanvasNodeType.AssetStoryboard], metadata: { status: "idle" } },
} satisfies Record<CanvasNodeType, CanvasNodeSpec>;

export function getNodeSpec(type: string) {
    if ((Object.values(CanvasNodeType) as string[]).includes(type)) return NODE_SPECS[type as CanvasNodeType];
    const spec = getRegistryNodeSpec(type);
    return { width: spec.width, height: spec.height, title: spec.title, metadata: spec.metadata };
}
