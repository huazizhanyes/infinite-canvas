import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeMetadata } from "@/types/canvas";
import { getNodeSpec as getRegistryNodeSpec } from "@/lib/canvas/node-registry";

type CanvasNodeSpec = { width: number; height: number; title: string; metadata?: CanvasNodeMetadata };

export const NODE_DEFAULT_SIZE = {
    [CanvasNodeType.Image]: { width: 340, height: 240, title: "图片" },
    [CanvasNodeType.Text]: { width: 340, height: 240, title: "文本" },
    [CanvasNodeType.Config]: { width: 340, height: 240, title: "生成配置" },
    [CanvasNodeType.Video]: { width: 420, height: 236, title: "视频" },
    [CanvasNodeType.Audio]: { width: 340, height: 120, title: "音频" },
    [CanvasNodeType.Group]: { width: 760, height: 480, title: "组" },
    [CanvasNodeType.ScriptSet]: { width: 360, height: 210, title: "剧本集" },
    [CanvasNodeType.Storyboard]: { width: 360, height: 210, title: "分镜脚本" },
    [CanvasNodeType.StoryboardGrid]: { width: 360, height: 260, title: "九宫格分镜" },
} satisfies Record<CanvasNodeType, { width: number; height: number; title: string }>;

export const NODE_SPECS = {
    [CanvasNodeType.Image]: { ...NODE_DEFAULT_SIZE[CanvasNodeType.Image], metadata: { content: "", status: "idle" } },
    [CanvasNodeType.Text]: { ...NODE_DEFAULT_SIZE[CanvasNodeType.Text], metadata: { content: "", status: "idle", fontSize: 13 } },
    [CanvasNodeType.Config]: { ...NODE_DEFAULT_SIZE[CanvasNodeType.Config], metadata: { content: "", status: "idle", generationMode: "image" } },
    [CanvasNodeType.Video]: { ...NODE_DEFAULT_SIZE[CanvasNodeType.Video], metadata: { content: "", status: "idle" } },
    [CanvasNodeType.Audio]: { ...NODE_DEFAULT_SIZE[CanvasNodeType.Audio], metadata: { content: "", status: "idle" } },
    [CanvasNodeType.Group]: { ...NODE_DEFAULT_SIZE[CanvasNodeType.Group], metadata: { status: "idle" } },
    [CanvasNodeType.ScriptSet]: { ...NODE_DEFAULT_SIZE[CanvasNodeType.ScriptSet], metadata: { status: "idle" } },
    [CanvasNodeType.Storyboard]: { ...NODE_DEFAULT_SIZE[CanvasNodeType.Storyboard], metadata: { status: "idle" } },
    [CanvasNodeType.StoryboardGrid]: { ...NODE_DEFAULT_SIZE[CanvasNodeType.StoryboardGrid], metadata: { storyboardGridStatus: "idle", storyboardGridAspectRatio: "16:9", storyboardGridVisualStyle: "电影感、统一角色与光线" } },
} satisfies Record<CanvasNodeType, CanvasNodeSpec>;

export function getNodeSpec(type: string) {
    if ((Object.values(CanvasNodeType) as string[]).includes(type)) return NODE_SPECS[type as CanvasNodeType];
    const spec = getRegistryNodeSpec(type);
    return { width: spec.width, height: spec.height, title: spec.title, metadata: spec.metadata };
}
