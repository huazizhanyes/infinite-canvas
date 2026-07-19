import { buildApiUrl, type AiConfig } from "@/stores/use-config-store";
import type { CanvasAgentSnapshot, CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";

export type BackendAgentModel = { id: number; modelKey: string; modelName: string; displayName: string; providerName: string };
export type BackendAgentConfig = { enabled: boolean; model: BackendAgentModel | null; visionModel: BackendAgentModel | null; maxSteps: number; maxOps: number };
export type BackendAgentConversation = { id: string; projectId: string; title: string; createdAt: string; updatedAt: string };
export type BackendAgentMessage = { id: string; turnId?: string; role: "user" | "assistant" | "tool"; content: string; toolCallId?: string; toolName?: string; toolPayload?: unknown; status: string; createdAt: string };
export type BackendAgentPendingTool = { turnId: string; callId: string; name: "canvas_apply_ops"; input: { ops: CanvasAgentOp[] } };
export type BackendAgentStreamEvent = { event: string; data: Record<string, any> };

export async function getBackendAgentConfig(config: AiConfig) {
    return apiJson<BackendAgentConfig>(config, "/agent/config");
}

export async function listBackendAgentConversations(config: AiConfig, projectId: string) {
    const result = await apiJson<{ data?: BackendAgentConversation[] }>(config, `/agent/conversations?projectId=${encodeURIComponent(projectId)}`);
    return result.data || [];
}

export async function createBackendAgentConversation(config: AiConfig, projectId: string, title?: string) {
    const result = await apiJson<{ data: BackendAgentConversation }>(config, "/agent/conversations", {
        method: "POST",
        body: JSON.stringify({ projectId, title }),
    });
    return result.data;
}

export async function getBackendAgentMessages(config: AiConfig, conversationId: string) {
    const result = await apiJson<{ data?: BackendAgentMessage[] }>(config, `/agent/conversations/${encodeURIComponent(conversationId)}/messages`);
    return result.data || [];
}

export async function deleteBackendAgentConversation(config: AiConfig, conversationId: string) {
    await apiJson(config, `/agent/conversations/${encodeURIComponent(conversationId)}`, { method: "DELETE" });
}

export function streamBackendAgentTurn(
    config: AiConfig,
    input: { conversationId: string; clientTurnId: string; prompt: string; snapshot: CanvasAgentSnapshot },
    signal: AbortSignal,
    onEvent: (event: BackendAgentStreamEvent) => void,
) {
    return apiStream(config, "/agent/turns", input, signal, onEvent);
}

export function streamBackendAgentToolResult(
    config: AiConfig,
    turnId: string,
    input: { callId: string; decision: "approved" | "rejected"; result?: unknown; snapshot: CanvasAgentSnapshot },
    signal: AbortSignal,
    onEvent: (event: BackendAgentStreamEvent) => void,
) {
    return apiStream(config, `/agent/turns/${encodeURIComponent(turnId)}/tool-result`, input, signal, onEvent);
}

export async function cancelBackendAgentTurn(config: AiConfig, turnId: string) {
    await apiJson(config, `/agent/turns/${encodeURIComponent(turnId)}/cancel`, { method: "POST" });
}

function agentRequestConfig(config: AiConfig) {
    const channel = config.channels.find((item) => item.id === "sucai-canvas");
    return channel ? { baseUrl: channel.baseUrl, apiKey: channel.apiKey } : { baseUrl: config.baseUrl, apiKey: config.apiKey };
}

async function apiJson<T = unknown>(config: AiConfig, path: string, init: RequestInit = {}) {
    const requestConfig = agentRequestConfig(config);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${requestConfig.apiKey}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(buildApiUrl(requestConfig.baseUrl, path), { ...init, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(readApiError(payload, `Agent 请求失败 (${response.status})`));
    return payload as T;
}

async function apiStream(config: AiConfig, path: string, body: unknown, signal: AbortSignal, onEvent: (event: BackendAgentStreamEvent) => void) {
    const requestConfig = agentRequestConfig(config);
    const response = await fetch(buildApiUrl(requestConfig.baseUrl, path), {
        method: "POST",
        headers: { Authorization: `Bearer ${requestConfig.apiKey}`, "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal,
    });
    if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(readApiError(payload, `Agent 请求失败 (${response.status})`));
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || "";
        frames.forEach((frame) => {
            let event = "message";
            const data: string[] = [];
            frame.split(/\r?\n/).forEach((line) => {
                if (line.startsWith("event:")) event = line.slice(6).trim();
                if (line.startsWith("data:")) data.push(line.slice(5).trim());
            });
            if (!data.length) return;
            try {
                onEvent({ event, data: JSON.parse(data.join("\n")) });
            } catch {
                onEvent({ event: "error", data: { message: "Agent 返回了无法解析的数据" } });
            }
        });
        if (done) break;
    }
}

function readApiError(payload: any, fallback: string) {
    const message = payload?.message || payload?.error?.message || payload?.error;
    return Array.isArray(message) ? message.join("；") : String(message || fallback);
}
