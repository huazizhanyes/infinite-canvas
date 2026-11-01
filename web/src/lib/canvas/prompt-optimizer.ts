import { nanoid } from "nanoid";

import { normalizeCanvasResourceMentions, parseCanvasResourceMentionTokens, plainCanvasResourceMentions, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { canvasTextApi } from "@/services/api/canvas-text";
import type { UserAssetConnection } from "@/services/api/user-assets";

const SYSTEM_PROMPT = `你是专业的 AI 绘画提示词工程师。用户会给你一段可能口语化、不专业的图片生成提示词，你的任务是把用户的需求改写成一条结构清晰、细节完整的专业提示词。

改写要求：
1. 忠实保留用户的原始意图，不得新增用户没有表达的主体、情节或要求；用户未提及的维度（场景氛围、构图视角、光线、色调、风格、画质）可以做合理的补充，但必须与原意协调。
2. 按「主体与动作 -> 场景与环境 -> 构图与视角 -> 光线 -> 色调与氛围 -> 风格 -> 画质与细节」的顺序组织成一段连贯的自然语言，不要分点、不要标题、不要 markdown、不要引号。
3. 形如 @图片1、@资产·xxx 的引用标记代表用户上传的参考素材，必须原样保留：一个都不能删、不能改名、不能改写成其他形式、也不能新增引用。
4. 与参考素材相关的需求必须继续以引用标记表达（例如"保持与@图片2一致的色调"），不得把对参考图的需求凭空改写成具体描述。
5. 输出语言跟随用户输入：用户用中文就输出中文，用户用英文就输出英文。
6. 输出长度必须与原文信息量匹配：原文很短时精炼补全即可；原文已经很长、细节很多时，必须完整保留用户已写明的所有细节，不得为了精简而删减，改写后长度大致在原文的 0.8~1.5 倍之间，最长不超过 1500 字。只输出改写后的提示词本身，不要任何解释、前缀或补充说明。`;

const REFERENCE_KIND_LABEL: Record<CanvasResourceReference["kind"], string> = { image: "参考图片", video: "参考视频", audio: "参考音频", text: "参考文本" };

export type OptimizeImagePromptOptions = {
    connection: UserAssetConnection;
    prompt: string;
    references: CanvasResourceReference[];
    model?: string;
};

/**
 * 把画布输入框里的口语化图片提示词交给默认文本模型改写为专业提示词。
 * 素材引用（@[图片1](canvas-ref:xxx) token）在调用前转成纯文本 @图片1，
 * 拿到结果后校验引用没有丢失，再还原成 token；丢失引用视为失败，由上层提示重试。
 */
export async function optimizeImagePrompt({ connection, prompt, references, model }: OptimizeImagePromptOptions, signal?: AbortSignal): Promise<string> {
    const trimmed = prompt.trim();
    if (!trimmed) throw new Error("请先输入提示词再优化");
    const mentionLabels = collectMentionLabels(trimmed, references);
    const plainPrompt = plainCanvasResourceMentions(trimmed);
    const mentionContext = mentionLabels.length
        ? `用户的提示词里包含以下素材引用，含义：\n${mentionLabels.map((reference) => `@${reference.label}：${REFERENCE_KIND_LABEL[reference.kind]}${reference.title && reference.title !== reference.label ? `（${reference.title}）` : ""}`).join("\n")}\n\n`
        : "";
    const completion = await canvasTextApi.complete(
        connection,
        {
            requestId: nanoid(),
            input: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: `${mentionContext}用户的原始提示词：\n${plainPrompt}` },
            ],
            ...(model ? { model } : {}),
            maxOutputTokens: 6000,
        },
        signal,
    );
    const output = completion.outputText.trim();
    if (!output) throw new Error("优化结果为空，请重试");
    const missing = mentionLabels.filter((reference) => !containsMentionLabel(output, reference.label));
    if (missing.length) throw new Error(`优化结果丢失了素材引用（${missing.map((item) => `@${item.label}`).join("、")}），请重试`);
    // 把结果里的 @标签 还原成画布引用 token；token 原有的 nodeId 必须保留，因此显式补进 references。
    const restoreReferences = [...references, ...mentionLabels.map((reference) => ({ ...reference, active: true }))];
    return normalizeCanvasResourceMentions(output, restoreReferences);
}

/** 收集提示词里出现的素材引用（含序列化 token 与纯文本 @标签 两种形态）。 */
function collectMentionLabels(prompt: string, references: CanvasResourceReference[]): CanvasResourceReference[] {
    const canvasReferences = references.filter((reference) => reference.source === "canvas");
    const byNodeId = new Map(canvasReferences.map((reference) => [reference.nodeId, reference]));
    const collected: CanvasResourceReference[] = [];
    const seen = new Set<string>();
    for (const token of parseCanvasResourceMentionTokens(prompt)) {
        const reference = byNodeId.get(token.nodeId);
        if (!reference || seen.has(reference.nodeId)) continue;
        seen.add(reference.nodeId);
        collected.push(reference);
    }
    const labels = canvasReferences.map((reference) => reference.label).sort((left, right) => right.length - left.length);
    for (const label of labels) {
        if (seen.has(label)) continue;
        if (containsMentionLabel(plainCanvasResourceMentions(prompt), label)) {
            const reference = canvasReferences.find((item) => item.label === label);
            if (reference) {
                seen.add(label);
                collected.push(reference);
            }
        }
    }
    return collected;
}

function containsMentionLabel(text: string, label: string) {
    const encoded = text.replaceAll(label, `§${label}§`);
    return encoded.includes(`@§${label}§`);
}
