import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Empty, Spin } from "antd";
import { History, MessageSquareText, Plus, Trash2 } from "lucide-react";

import { AgentChatComposer, AgentChatMessage, AgentPanelTabs, AgentPendingToolCard, AgentWorkingMessage, type CanvasAgentChatMessage } from "@/components/canvas/canvas-agent-chat-ui";
import { summarizeCanvasAgentOps, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { canvasThemes } from "@/lib/canvas-theme";
import { randomId } from "@/lib/utils";
import {
    cancelBackendAgentTurn,
    createBackendAgentConversation,
    deleteBackendAgentConversation,
    getBackendAgentConfig,
    getBackendAgentMessages,
    listBackendAgentConversations,
    streamBackendAgentToolResult,
    streamBackendAgentTurn,
    type BackendAgentConfig,
    type BackendAgentConversation,
    type BackendAgentMessage,
    type BackendAgentPendingTool,
    type BackendAgentStreamEvent,
} from "@/services/api/canvas-agent";
import { syncSucaiCanvasProject } from "@/services/sucai-canvas-sync";
import { useAgentStore } from "@/stores/use-agent-store";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

type BackendAgentTab = "chat" | "history";

export function CanvasBackendAgentPanel() {
    const { message, modal } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const user = useUserStore((state) => state.user);
    const config = useEffectiveConfig();
    const canvasContext = useAgentStore((state) => state.canvasContext);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const [agentConfig, setAgentConfig] = useState<BackendAgentConfig | null>(null);
    const [conversations, setConversations] = useState<BackendAgentConversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState("");
    const [messages, setMessages] = useState<CanvasAgentChatMessage[]>([]);
    const [pendingTool, setPendingTool] = useState<BackendAgentPendingTool | null>(null);
    const [prompt, setPrompt] = useState("");
    const [activeTab, setActiveTab] = useState<BackendAgentTab>("chat");
    const [loading, setLoading] = useState(true);
    const [waiting, setWaiting] = useState(false);
    const [activeTurnId, setActiveTurnId] = useState("");
    const listRef = useRef<HTMLDivElement>(null);
    const requestRef = useRef<AbortController | null>(null);
    const appliedToolSnapshotsRef = useRef(new Map<string, CanvasAgentSnapshot>());
    const activeConversationRef = useRef("");
    const projectId = canvasContext?.snapshot.projectId || "";

    useEffect(() => {
        activeConversationRef.current = activeConversationId;
    }, [activeConversationId]);

    useEffect(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }, [messages, pendingTool, waiting]);

    const loadMessages = useCallback(async (conversationId: string) => {
        if (!conversationId) {
            setMessages([]);
            setPendingTool(null);
            return;
        }
        const rows = await getBackendAgentMessages(config, conversationId);
        setMessages(rows.flatMap(toChatMessage));
        setPendingTool(findPendingTool(rows));
    }, [config]);

    const loadConversations = useCallback(async (preferredId?: string) => {
        if (!projectId) return;
        const rows = await listBackendAgentConversations(config, projectId);
        setConversations(rows);
        const current = preferredId || activeConversationRef.current;
        const nextId = rows.some((item) => item.id === current) ? current : rows[0]?.id || "";
        setActiveConversationId(nextId);
        await loadMessages(nextId);
    }, [config, loadMessages, projectId]);

    useEffect(() => {
        if (!projectId) {
            activeConversationRef.current = "";
            appliedToolSnapshotsRef.current.clear();
            setConversations([]);
            setActiveConversationId("");
            setMessages([]);
            setPendingTool(null);
            setLoading(false);
            setAgentState({ connected: false, activity: "请先打开画布" });
            return;
        }
        let disposed = false;
        activeConversationRef.current = "";
        appliedToolSnapshotsRef.current.clear();
        setActiveConversationId("");
        setMessages([]);
        setPendingTool(null);
        setLoading(true);
        void Promise.all([getBackendAgentConfig(config), syncSucaiCanvasProject(projectId)])
            .then(async ([nextConfig]) => {
                if (disposed) return;
                setAgentConfig(nextConfig);
                setAgentState({ enabled: nextConfig.enabled, connected: nextConfig.enabled, activity: nextConfig.enabled ? "就绪" : "未启用" });
                if (nextConfig.enabled) await loadConversations();
            })
            .catch((error) => {
                if (disposed) return;
                const text = error instanceof Error ? error.message : "Agent 初始化失败";
                setMessages([{ id: randomId(), role: "error", title: "初始化失败", text }]);
                setAgentState({ enabled: false, connected: false, activity: "不可用" });
            })
            .finally(() => {
                if (!disposed) setLoading(false);
            });
        return () => {
            disposed = true;
            requestRef.current?.abort();
        };
    }, [projectId]);

    const ensureConversation = async () => {
        if (activeConversationRef.current) return activeConversationRef.current;
        await syncSucaiCanvasProject(projectId);
        const created = await createBackendAgentConversation(config, projectId);
        activeConversationRef.current = created.id;
        setActiveConversationId(created.id);
        setConversations((current) => [created, ...current]);
        return created.id;
    };

    const handleStreamEvent = (event: BackendAgentStreamEvent) => {
        if (event.event === "turn_started") {
            setActiveTurnId(String(event.data.turnId || ""));
            setAgentState({ activity: "思考中" });
        }
        if (event.event === "tool_call") {
            setPendingTool(event.data as BackendAgentPendingTool);
            setWaiting(false);
            setAgentState({ activity: "等待确认" });
            void loadMessages(activeConversationRef.current);
        }
        if (event.event === "assistant_message") void loadMessages(activeConversationRef.current);
        if (event.event === "done") {
            setWaiting(false);
            setActiveTurnId("");
            setAgentState({ activity: event.data.status === "canceled" ? "已停止" : "完成" });
            void Promise.all([loadMessages(activeConversationRef.current), loadConversations(activeConversationRef.current)]);
        }
        if (event.event === "error") {
            const text = String(event.data.message || "Agent 调用失败");
            setMessages((current) => [...current, { id: randomId(), role: "error", title: "Agent 出错", text }]);
            setWaiting(false);
            setActiveTurnId("");
            setAgentState({ activity: "出错" });
        }
    };

    const runStream = async (request: (controller: AbortController) => Promise<void>) => {
        const controller = new AbortController();
        requestRef.current = controller;
        setWaiting(true);
        try {
            await request(controller);
            return true;
        } catch (error) {
            if (controller.signal.aborted) return false;
            const text = error instanceof Error ? error.message : "Agent 请求失败";
            setMessages((current) => [...current, { id: randomId(), role: "error", title: "请求失败", text }]);
            setAgentState({ activity: "出错" });
            return false;
        } finally {
            if (requestRef.current === controller) requestRef.current = null;
            setWaiting(false);
        }
    };

    const sendPrompt = async () => {
        const text = prompt.trim();
        const snapshot = canvasContext?.snapshot;
        if (!text || !snapshot || waiting || pendingTool) return;
        const conversationId = await ensureConversation();
        setPrompt("");
        setMessages((current) => [...current, { id: randomId(), role: "user", text }]);
        await runStream((controller) => streamBackendAgentTurn(config, { conversationId, clientTurnId: randomId(), prompt: text, snapshot }, controller.signal, handleStreamEvent));
    };

    const resolvePendingTool = async (decision: "approved" | "rejected") => {
        const tool = pendingTool;
        const context = useAgentStore.getState().canvasContext;
        if (!tool || !context) return;
        const appliedSnapshot = decision === "approved" ? appliedToolSnapshotsRef.current.get(tool.callId) : undefined;
        const nextSnapshot = decision === "approved" ? appliedSnapshot || context.applyOps(tool.input.ops) : context.snapshot;
        if (decision === "approved" && !appliedSnapshot) appliedToolSnapshotsRef.current.set(tool.callId, nextSnapshot);
        setPendingTool(null);
        setWaiting(true);
        setAgentState({ activity: decision === "approved" ? "执行画布操作" : "已拒绝，等待回复" });
        const completed = await runStream((controller) => streamBackendAgentToolResult(config, tool.turnId, { callId: tool.callId, decision, result: decision === "approved" ? nextSnapshot : undefined, snapshot: nextSnapshot }, controller.signal, handleStreamEvent));
        if (!completed) await loadMessages(activeConversationRef.current).catch(() => undefined);
    };

    const stopTurn = async () => {
        const turnId = activeTurnId || pendingTool?.turnId;
        if (turnId) await cancelBackendAgentTurn(config, turnId).catch(() => undefined);
        requestRef.current?.abort();
        setPendingTool(null);
        setWaiting(false);
        setActiveTurnId("");
        setAgentState({ activity: "已停止" });
    };

    const createConversation = async () => {
        if (!projectId || waiting) return;
        await syncSucaiCanvasProject(projectId);
        const created = await createBackendAgentConversation(config, projectId);
        setConversations((current) => [created, ...current]);
        activeConversationRef.current = created.id;
        setActiveConversationId(created.id);
        setMessages([]);
        setPendingTool(null);
        setActiveTab("chat");
    };

    const removeConversation = (conversation: BackendAgentConversation) => {
        modal.confirm({
            title: "删除 Agent 对话",
            content: `确认删除“${conversation.title}”吗？`,
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                await deleteBackendAgentConversation(config, conversation.id);
                message.success("对话已删除");
                await loadConversations();
            },
        });
    };

    if (!projectId) return <Empty className="my-auto" image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先打开一个画布" />;
    if (loading) return <div className="grid min-h-0 flex-1 place-items-center"><Spin /></div>;
    if (!agentConfig?.enabled) return <Empty className="my-auto" image={Empty.PRESENTED_IMAGE_SIMPLE} description="画布 Agent 暂未启用" />;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <AgentPanelTabs
                value={activeTab}
                theme={theme}
                onChange={setActiveTab}
                items={[
                    { value: "chat", label: "对话", icon: <MessageSquareText className="size-4" /> },
                    { value: "history", label: "历史", icon: <History className="size-4" />, count: conversations.length },
                ]}
                right={<Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" disabled={waiting} icon={<Plus className="size-4" />} onClick={() => void createConversation()} aria-label="新对话" />}
            />
            {activeTab === "history" ? (
                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
                    <div className="space-y-1">
                        {conversations.map((item) => (
                            <div key={item.id} className="group flex items-center gap-2 rounded-md px-2 py-2 transition" style={{ background: item.id === activeConversationId ? theme.toolbar.activeBg : "transparent" }}>
                                <button type="button" className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => {
                                    activeConversationRef.current = item.id;
                                    setActiveConversationId(item.id);
                                    void loadMessages(item.id);
                                    setActiveTab("chat");
                                }}>{item.title}</button>
                                <Button type="text" shape="circle" className="!h-7 !w-7 !min-w-7 opacity-0 group-hover:opacity-100" danger icon={<Trash2 className="size-3.5" />} onClick={() => removeConversation(item)} />
                            </div>
                        ))}
                        {!conversations.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无对话" /> : null}
                    </div>
                </div>
            ) : (
                <>
                    <div className="border-b px-4 py-2 text-[11px]" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                        {agentConfig.model?.displayName || "Agent"}{agentConfig.visionModel ? ` · 视觉：${agentConfig.visionModel.displayName}` : ""}
                    </div>
                    <div ref={listRef} className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                        {messages.map((item) => <AgentChatMessage key={item.id} item={item} theme={theme} user={user} />)}
                        {pendingTool ? (
                            <AgentPendingToolCard
                                summary={toolSummary(pendingTool)}
                                detail={pendingTool}
                                theme={theme}
                                onReject={() => void resolvePendingTool("rejected")}
                                onApprove={() => void resolvePendingTool("approved")}
                            />
                        ) : null}
                        {waiting && !pendingTool ? <AgentWorkingMessage theme={theme} /> : null}
                        {!messages.length && !pendingTool && !waiting ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="开始新的画布对话" /> : null}
                    </div>
                    <AgentChatComposer
                        prompt={prompt}
                        disabled={!canvasContext || Boolean(pendingTool)}
                        sending={waiting}
                        placeholder="让 DeepSeek 读取或操作当前画布"
                        theme={theme}
                        onPromptChange={setPrompt}
                        onSubmit={() => void sendPrompt()}
                        onStop={() => void stopTurn()}
                    />
                </>
            )}
        </div>
    );
}

function toChatMessage(row: BackendAgentMessage): CanvasAgentChatMessage[] {
    if (row.role === "assistant" && row.toolCallId) return [];
    if (row.role === "tool") {
        const rejected = row.status === "rejected";
        return [{ id: row.id, role: "tool", title: rejected ? "已拒绝画布操作" : "画布操作完成", text: rejected ? "用户拒绝执行" : "已批准并执行", detail: row }];
    }
    if (!row.content) return [];
    return [{ id: row.id, role: row.role, text: row.content }];
}

function findPendingTool(rows: BackendAgentMessage[]) {
    const row = [...rows].reverse().find((item) => item.role === "assistant" && item.status === "pending" && item.toolCallId && item.turnId);
    const payload = row?.toolPayload as { input?: { ops?: BackendAgentPendingTool["input"]["ops"] } } | undefined;
    if (!row?.toolCallId || !row.turnId || !payload?.input?.ops) return null;
    return { turnId: row.turnId, callId: row.toolCallId, name: "canvas_apply_ops" as const, input: { ops: payload.input.ops } };
}

function toolSummary(tool: BackendAgentPendingTool) {
    const base = summarizeCanvasAgentOps(tool.input.ops) || "画布操作";
    return tool.input.ops.some((op) => op.type === "run_generation") ? `${base}，其中包含会消耗额度的生成操作` : base;
}
