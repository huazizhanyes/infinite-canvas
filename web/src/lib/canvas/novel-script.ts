import { nanoid } from "nanoid";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

// 「小说改剧本」节点的纯逻辑：prompt 组装 + 统计 + 结果节点建点 ops。
// prompt 正文 1:1 搬运自后端 flash_nest/src/drama-studio/drama-prompt-seed.ts（与 /drama、素材网快捷助手同源）：
//   - system = script_rewriter agent 正文 + "---" + 「技能细则：剧本改写细则」(skill:script-rewriter)
//     + 「本次运行说明」（无工具单轮版的试跑包装，与后端 ai-tools.service 同文案）
//   - user = rewrite_to_screenplay 工具指令（格式规范 + 【原始内容】原文），与 /drama 注入工具结果的文案逐字一致
//   - 字数/场景数口径 ← save_script 工具（word_count 去空白、scene_count 匹配 ## S\d+）
// 注意：后端读 DB 在线版（提示词管理页可改、即时生效）；画布是前端快照，只对应 seed 初始版——
// 管理员在提示词管理页改过正文时，需要回 here 同步一次（文件头有对照表）。

export const NOVEL_SCRIPT_MAX_SOURCE = 6000;
export const NOVEL_SCRIPT_MAX_SCRIPT = 10000;

/** drama-prompt-seed.ts → script_rewriter（agent）正文快照 */
const SCRIPT_REWRITER_SYSTEM = `你是专业编剧，擅长将小说改编为短剧剧本。

工作流程：
1. 调用 read_episode_script 读取原始内容
2. 根据读取到的内容，自己进行改写（输出格式化剧本格式）
3. 调用 save_script 保存改写后的完整剧本

格式化剧本格式：
- 场景头：## S编号 | 内景/外景 · 地点 | 时间段
- 动作描写：自然段落，不包含镜头语言
- 对白：角色名：（状态/表情）台词内容
- 每个场景 30-60 秒内容

注意：你必须自己完成改写工作，不要只返回指令。读取内容后直接输出改写结果并保存。`;

/** drama-prompt-seed.ts → skill:script-rewriter（技能细则）正文快照 */
const SCRIPT_REWRITER_SKILL = `# 剧本改写指南

## 改写原则

1. **保留核心情节**：不改变主线故事和角色关系
2. **增强画面感**：将叙述性文字转化为可视化的场景描写
3. **对话驱动**：用对白推动情节，减少旁白
4. **节奏把控**：每场戏控制在 30-60 秒，适合短视频
5. **不写镜头语言**：不涉及景别、角度、运镜，这些属于分镜拆解步骤

## 格式化剧本格式

\`\`\`
## S01 | 内景 · 咖啡厅 | 黄昏

黄昏的光线透过落地窗洒进咖啡厅，吧台上咖啡杯热气升腾。

小明独自坐在角落卡座，低头看手机，神情有些焦虑。

门铃响起，小红推门而入。她看到小明，微笑着走过去。

小红：（微笑）等很久了吗？
小明：（抬头）还好，刚到。
\`\`\`

### 格式规则

- \`## S编号 | 内景/外景 · 地点 | 时间段\` — 场景头
- 动作描写自然段 — 不包含任何镜头语言
- \`角色名：（状态/表情）台词内容\` — 对白格式

### 内容量参考

格式化剧本相比原始内容增加约 20-30%，主要增量是场景头标记和对白格式化，不是扩写。

## 改写步骤

1. 先调用 \`read_episode_script\` 读取原始内容
2. 分析内容结构（对话、叙述、心理描写的比例）
3. 调用 \`rewrite_to_screenplay\` 执行改写
4. 检查改写结果，确认符合格式化剧本格式
5. 调用 \`save_script\` 保存最终结果

## 注意事项

- 心理描写可转化为角色表情/动作或画外音
- 长段叙述拆分为多个短场景
- 确保每个场景有明确的情绪转折点
- 保持角色语言风格一致性
- 场景编号连续递增（S01, S02, S03...）
- 时间段要具体（黄昏、深夜、清晨），不要笼统写"白天"`;

/** 与后端 ai-tools.service 的 sharedRule 同文案：无工具单轮版的「试跑包装」 */
const SHARED_RULE = `# 本次运行说明
本次是**一次性快捷工具**：没有工具可用，不要输出任何工具调用（read_* / save_* / update_* 等），也不要解释你的思路，**直接输出最终结果正文**。全部使用简体中文。`;

/** 与后端 DramaPromptService.resolve 同结构：agent 正文 + --- + 技能细则，再拼运行说明 */
const NOVEL_SCRIPT_SYSTEM_PROMPT = `${SCRIPT_REWRITER_SYSTEM}

---

# 技能细则：剧本改写细则

${SCRIPT_REWRITER_SKILL}

${SHARED_RULE}`;

/** 组装 /v1/responses 的 input 消息（user 消息与后端 rewrite_to_screenplay 指令逐字一致）。 */
export function buildNovelScriptInput(source: string): Array<{ role: "system" | "user"; content: string }> {
    const raw = String(source || "").trim();
    return [
        { role: "system", content: NOVEL_SCRIPT_SYSTEM_PROMPT },
        {
            role: "user",
            content: `请将以下内容改写为格式化剧本。

格式规范：
- 场景头：## S编号 | 内景/外景 · 地点 | 时间段
- 动作描写：自然段落，不包含镜头语言
- 对白：角色名：（状态/表情）台词内容
- 每个场景 30-60 秒内容


【原始内容】
${raw}`,
        },
    ];
}

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
