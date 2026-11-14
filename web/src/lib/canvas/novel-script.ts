import { nanoid } from "nanoid";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

// 仅保留界面统计与结果节点逻辑；提示词由后端统一管理。
export const NOVEL_SCRIPT_MAX_SOURCE = 7000;
export const NOVEL_SCRIPT_MAX_SCRIPT = 10000;

/** 与后端 save_script 同口径：去空白字符数。 */
export function novelWordCount(text: string) {
    return String(text || "").replace(/\s/g, "").length;
}

/** 与原版 ScriptStage 同口径：字数 ÷ 500字/分钟。 */
export function novelEstimateSeconds(wordCount: number) {
    return Math.round((wordCount / 500) * 60);
}

/** 与后端 save_script 同口径：场景数 = 匹配 ## S\d+ 的行数。 */
export function novelSceneCount(script: string) {
    return (String(script || "").match(/^##\s*S\d+/gm) || []).length;
}

export type NovelScriptResultOpsInput = {
    sourceNode: CanvasNodeData;
    script: string;
    nodes: CanvasNodeData[];
};

/** 生成成功后：在源节点右侧新建一个独立的「剧本」节点（每次生成新建，不覆盖旧结果）并连线、选中。 */
export function buildNovelScriptResultOps(input: NovelScriptResultOpsInput): CanvasAgentOp[] {
    const { sourceNode, script, nodes } = input;
    const existingCount = nodes.filter((node) => node.type === CanvasNodeType.ScriptResult && node.metadata?.scriptSourceNodeId === sourceNode.id).length;
    const sceneCount = novelSceneCount(script);
    const id = nanoid();
    return [
        {
            type: "add_node",
            id,
            nodeType: CanvasNodeType.ScriptResult,
            title: sceneCount ? `剧本 · ${sceneCount} 场` : "剧本",
            position: {
                x: sourceNode.position.x + sourceNode.width + 120,
                y: sourceNode.position.y + existingCount * 400,
            },
            width: 420,
            height: 360,
            metadata: {
                status: "idle",
                scriptContent: script,
                scriptSourceNodeId: sourceNode.id,
            },
        },
        { type: "connect_nodes", id: nanoid(), fromNodeId: sourceNode.id, toNodeId: id },
        { type: "select_nodes", ids: [id] },
    ];
}
