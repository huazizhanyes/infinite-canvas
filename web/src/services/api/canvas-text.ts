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
