import axios from "axios";

import type { UserAssetConnection } from "@/services/api/user-assets";

export type CanvasTextOperation = "continue" | "polish" | "expand" | "shorten" | "summarize" | "translate" | "custom";

export type CanvasTextEstimate = {
    model: string;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    estimatedTotalTokens: number;
    availableTokens: number;
};

export type CanvasTextCompletion = {
    id: string;
    model: string;
    outputText: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        chargedTokens: number;
        source?: string;
    };
};

type Envelope<T> = { code?: number; data?: T };

const base = (connection: UserAssetConnection) => `${connection.canvasBaseUrl.replace(/\/+$/, "")}/v1`;
const headers = (connection: UserAssetConnection) => ({ Authorization: `Bearer ${connection.token}` });

function unwrap<T>(value: Envelope<T> | T): T {
    if (value && typeof value === "object" && "data" in value && value.data !== undefined) return value.data as T;
    return value as T;
}

function number(value: unknown) {
    return Number(value || 0);
}

export const canvasTextApi = {
    /** Shared rewrite endpoint; prompts and generation rules live on the server. */
    async rewriteNovel(connection: UserAssetConnection, payload: { requestId: string; text: string; model?: string }, signal?: AbortSignal) {
        const response = await fetch(`${connection.apiBaseUrl.replace(/\/+$/, '')}/ai-tools/v1/run`, {
            method: 'POST',
            headers: { ...headers(connection), 'Content-Type': 'application/json' },
            body: JSON.stringify({ feature: 'tool.script.rewrite', text: payload.text, model: payload.model, request_id: payload.requestId, entry: 'canvas' }),
            signal,
        });
        if (!response.ok || !response.body) throw new Error(`剧本改写请求失败（${response.status}）`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            for (;;) {
                const chunk = await reader.read();
                buffer = (buffer + decoder.decode(chunk.value, { stream: !chunk.done })).replace(/\r\n/g, '\n');
                let boundary = buffer.indexOf('\n\n');
                while (boundary >= 0) {
                    const block = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + 2);
                    let event = '';
                    const data: string[] = [];
                    for (const line of block.split('\n')) {
                        if (line.startsWith('event:')) event = line.slice(6).trim();
                        else if (line.startsWith('data:')) data.push(line.slice(5).trim());
                    }
                    if (data.length && (event === 'error' || event === 'done')) {
                        const value = JSON.parse(data.join('\n'));
                        if (event === 'error') throw new Error(String(value.message || '剧本改写失败'));
                        if (!String(value.text || '').trim()) throw new Error('服务未返回完整剧本');
                        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ds-text-billing-changed'));
                        return { id: payload.requestId, model: String(value.model || ''), outputText: String(value.text) };
                    }
                    boundary = buffer.indexOf('\n\n');
                }
                if (chunk.done) break;
            }
            throw new Error('改写连接中断，未收到完成确认，请查看调用历史后重试');
        } finally {
            await reader.cancel().catch(() => undefined);
            reader.releaseLock();
        }
    },

    async estimate(connection: UserAssetConnection, input: unknown[], model?: string, maxOutputTokens?: number) {
        const response = await axios.post<Envelope<Record<string, unknown>>>(
            `${base(connection)}/responses/estimate`,
            { input, ...(model ? { model } : {}), ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}) },
            { headers: headers(connection) },
        );
        const data = unwrap(response.data);
        return {
            model: String(data.model || model || ""),
            estimatedInputTokens: number(data.estimatedInputTokens ?? data.estimated_input_tokens),
            estimatedOutputTokens: number(data.estimatedOutputTokens ?? data.estimated_output_tokens),
            estimatedTotalTokens: number(data.estimatedTotalTokens ?? data.estimated_total_tokens),
            availableTokens: number(data.availableTokens ?? data.available_tokens),
        } satisfies CanvasTextEstimate;
    },

    async complete(connection: UserAssetConnection, payload: { requestId: string; input: unknown[]; model?: string; operation?: CanvasTextOperation; sourceNodeId?: string; maxOutputTokens?: number }, signal?: AbortSignal) {
        const response = await axios.post<Envelope<Record<string, unknown>>>(
            `${base(connection)}/responses`,
            {
                request_id: payload.requestId,
                input: payload.input,
                ...(payload.model ? { model: payload.model } : {}),
                ...(payload.operation ? { operation: payload.operation } : {}),
                ...(payload.sourceNodeId ? { source_node_id: payload.sourceNodeId } : {}),
                ...(payload.maxOutputTokens ? { max_output_tokens: payload.maxOutputTokens } : {}),
            },
            { headers: headers(connection), signal },
        );
        const data = unwrap(response.data);
        const usage = (data.usage || {}) as Record<string, unknown>;
        return {
            id: String(data.id || payload.requestId),
            model: String(data.model || payload.model || ""),
            outputText: String(data.output_text || data.outputText || ""),
            usage: {
                inputTokens: number(usage.input_tokens ?? usage.inputTokens),
                outputTokens: number(usage.output_tokens ?? usage.outputTokens),
                totalTokens: number(usage.total_tokens ?? usage.totalTokens),
                chargedTokens: number(usage.charged_tokens ?? usage.chargedTokens),
                source: usage.source ? String(usage.source) : undefined,
            },
        } satisfies CanvasTextCompletion;
    },
};
