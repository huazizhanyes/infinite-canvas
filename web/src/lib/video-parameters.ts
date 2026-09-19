import type { VideoParameterDefinition } from "@/stores/use-config-store";

/**
 * 视频"扩展参数"（videoParameters）的白名单工具。
 *
 * 背景：模型切换、模板复制、本地持久化都不会主动清理上一个模型留下的参数值，
 * 而服务端对"模型未声明任何扩展参数 + 请求里带非空 parameters"会直接返回
 * 400「当前模型未开放扩展参数」（flash_nest/src/canvas-video/canvas-video.service.ts
 * 的 validateParameters）。因此前端所有读取/发送 videoParameters 的地方，
 * 都必须按"当前模型的参数定义"做一次白名单过滤。
 */

function definitionsOf(definitions: VideoParameterDefinition[] | undefined): VideoParameterDefinition[] {
    return Array.isArray(definitions) ? definitions : [];
}

function definitionKey(definition: VideoParameterDefinition | undefined) {
    return String(definition?.key || "").trim();
}

function valueRecord(values: unknown): Record<string, unknown> {
    return values && typeof values === "object" && !Array.isArray(values) ? (values as Record<string, unknown>) : {};
}

/**
 * 只保留当前模型声明过的参数，丢弃其它模型残留的 key。
 * 值本身保持原样（包括 false / 0 / "" 这类合法假值）。
 */
export function sanitizeVideoParameters(
    definitions: VideoParameterDefinition[] | undefined,
    values: unknown,
): Record<string, unknown> {
    const source = valueRecord(values);
    const next: Record<string, unknown> = {};
    for (const definition of definitionsOf(definitions)) {
        const key = definitionKey(definition);
        if (!key) continue;
        if (source[key] !== undefined) next[key] = source[key];
    }
    return next;
}

/**
 * 切换视频模型时使用：保留在新模型里依然有效的已选值，缺失的用新模型的默认值补齐，
 * 新模型没有声明的参数一律丢弃。模型没有扩展参数时返回空对象。
 */
export function videoParametersForModel(
    definitions: VideoParameterDefinition[] | undefined,
    values: unknown,
): Record<string, unknown> {
    const source = valueRecord(values);
    const next: Record<string, unknown> = {};
    for (const definition of definitionsOf(definitions)) {
        const key = definitionKey(definition);
        if (!key) continue;
        if (source[key] !== undefined) next[key] = source[key];
        else if (definition.defaultValue !== undefined) next[key] = definition.defaultValue;
    }
    return next;
}