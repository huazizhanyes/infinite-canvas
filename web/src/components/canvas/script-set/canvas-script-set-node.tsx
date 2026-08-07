import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { AlertCircle, BookOpenText, Boxes, LoaderCircle, Maximize2, Minimize2, RefreshCw, UsersRound } from "lucide-react";

import { CanvasScriptWorkspace } from "@/components/canvas/script-set/canvas-script-workspace";
import { isScriptSetExpanded, SCRIPT_SET_COLLAPSED_SIZE, SCRIPT_SET_EXPANDED_SIZE } from "@/components/canvas/script-set/script-set-node-layout";
import { canvasScriptApi, type ScriptGenerationImage, type ScriptSet } from "@/services/api/canvas-script";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

export function CanvasScriptSetNode({ ctx }: { ctx: CanvasNodeContext }) {
    const connection = useUserStore((state) => state.connection);
    const scriptSetId = ctx.node.metadata?.scriptSetId;
    const expanded = isScriptSetExpanded(ctx.node.metadata, ctx.node.width, ctx.node.height);
    const [scriptSet, setScriptSet] = useState<ScriptSet | null>(null);
    const [loading, setLoading] = useState(Boolean(scriptSetId));
    const [error, setError] = useState<string | null>(null);
    const [refreshNonce, setRefreshNonce] = useState(0);

    const load = useCallback(async () => {
        if (!scriptSetId) {
            setLoading(false);
            return;
        }
        if (!connection) {
            setLoading(false);
            setError("请先登录后再使用剧本集");
            return;
        }
        setLoading(true);
        try {
            setScriptSet(await canvasScriptApi.getSet(connection, scriptSetId));
            setError(null);
        } catch (reason) {
            setError(readError(reason));
        } finally {
            setLoading(false);
        }
    }, [connection, scriptSetId]);

    useEffect(() => void load(), [load]);
    useEffect(() => {
        const refresh = (event: Event) => {
            if ((event as CustomEvent<{ scriptSetId?: string }>).detail?.scriptSetId === scriptSetId) void load();
        };
        window.addEventListener("canvas-script-set-updated", refresh);
        return () => window.removeEventListener("canvas-script-set-updated", refresh);
    }, [load, scriptSetId]);

    const refresh = useCallback(() => {
        setRefreshNonce((value) => value + 1);
        void load();
    }, [load]);

    const toggleExpanded = useCallback(() => {
        const next = !expanded;
        const size = next ? SCRIPT_SET_EXPANDED_SIZE : SCRIPT_SET_COLLAPSED_SIZE;
        ctx.updateMetadata({ scriptSetExpanded: next });
        ctx.updateNode(size);
        if (next) window.setTimeout(() => ctx.emit("canvas-fit-node", { nodeId: ctx.node.id, ...size, padding: 48 }), 0);
    }, [ctx, expanded]);

    const handleImagesReady = useCallback((images: ScriptGenerationImage[]) => ctx.emit("canvas-script-assets-ready", { scriptNodeId: ctx.node.id, images }), [ctx]);
    const handleWorkspaceError = useCallback((reason: string | null) => setError(reason), []);
    const stats = scriptSet?.stats;
    const assetCount = (stats?.assetCounts.character || 0) + (stats?.assetCounts.scene || 0) + (stats?.assetCounts.prop || 0);

    return (
        <div
            className="flex h-full w-full flex-col overflow-hidden"
            style={
                {
                    color: ctx.theme.node.text,
                    background: ctx.theme.node.panel,
                    "--ant-color-bg-container": ctx.theme.node.panel,
                    "--ant-color-fill-secondary": ctx.theme.toolbar.itemHover,
                    "--ant-color-fill-tertiary": ctx.theme.toolbar.activeBg,
                    "--ant-color-text-secondary": ctx.theme.node.muted,
                    "--ant-color-text-tertiary": ctx.theme.node.faint,
                } as CSSProperties
            }
            onWheel={(event) => {
                if ((event.target as HTMLElement).closest("[data-script-workspace-interactive]")) event.stopPropagation();
            }}
        >
            <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.toolbar.panel }}>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.toolbar.activeText }}>
                    <BookOpenText className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{scriptSet?.title || ctx.node.title}</span>
                    <span className="mt-0.5 block truncate text-[11px]" style={{ color: error ? "#ef4444" : ctx.theme.node.faint }}>
                        {error || (scriptSetId ? `${stats?.episodeCount || 0} 集 · ${assetCount} 个资产 · ${stats?.pendingCount || 0} 项待确认` : "正在初始化剧本集...")}
                    </span>
                </span>
                {loading ? <LoaderCircle className="size-4 shrink-0 animate-spin" style={{ color: ctx.theme.node.muted }} /> : error ? <AlertCircle className="size-4 shrink-0 text-red-500" /> : null}
                <HeaderButton label="刷新" onClick={refresh} theme={ctx.theme}>
                    <RefreshCw className="size-4" />
                </HeaderButton>
                <HeaderButton label={expanded ? "收起" : "展开"} onClick={toggleExpanded} theme={ctx.theme}>
                    {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </HeaderButton>
            </header>

            {!expanded ? <CollapsedSummary ctx={ctx} stats={stats} assetCount={assetCount} loading={loading} error={error} onExpand={toggleExpanded} onRetry={refresh} /> : null}

            {expanded && error ? (
                <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-[11px] text-red-500" style={{ borderColor: ctx.theme.node.stroke }} data-script-workspace-interactive onMouseDown={(event) => event.stopPropagation()}>
                    <AlertCircle className="size-4" />
                    <span className="min-w-0 flex-1 truncate">{error}</span>
                    <button type="button" className="rounded-md px-2 py-1 font-medium hover:bg-red-500/10" onClick={refresh}>
                        重试
                    </button>
                </div>
            ) : null}

            <div
                className="flex min-h-0 flex-1 flex-col"
                data-canvas-no-zoom
                data-script-workspace-interactive
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onWheel={(event) => event.stopPropagation()}
                style={{ display: expanded ? undefined : "none" }}
            >
                {scriptSetId ? (
                    <CanvasScriptWorkspace scriptSetId={scriptSetId} active={expanded} refreshNonce={refreshNonce} onError={handleWorkspaceError} onImagesReady={handleImagesReady} />
                ) : (
                    <div className="grid flex-1 place-items-center text-xs" style={{ color: ctx.theme.node.muted }}>
                        <span className="flex items-center gap-2">
                            <LoaderCircle className="size-4 animate-spin" />
                            正在初始化剧本集...
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}

function CollapsedSummary({ ctx, stats, assetCount, loading, error, onExpand, onRetry }: { ctx: CanvasNodeContext; stats?: ScriptSet["stats"]; assetCount: number; loading: boolean; error: string | null; onExpand: () => void; onRetry: () => void }) {
    return (
        <button
            type="button"
            className="flex min-h-0 w-full flex-1 flex-col p-3 text-left transition hover:bg-black/[.03]"
            style={{ color: ctx.theme.node.text }}
            onClick={error ? onRetry : onExpand}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="grid w-full grid-cols-3 gap-2">
                <Stat icon={<BookOpenText className="size-3.5" />} label="剧集" value={stats?.episodeCount || 0} ctx={ctx} />
                <Stat icon={<UsersRound className="size-3.5" />} label="人物" value={stats?.assetCounts.character || 0} ctx={ctx} />
                <Stat icon={<Boxes className="size-3.5" />} label="资产" value={assetCount} ctx={ctx} />
            </div>
            <div className="mt-auto flex w-full items-center justify-between gap-2 pt-2 text-[11px]" style={{ color: error ? "#ef4444" : ctx.theme.node.muted }}>
                <span>{error ? "点击重试" : `待确认 ${stats?.pendingCount || 0}`}</span>
                <span>{loading ? "正在读取..." : error ? "读取失败" : "点击展开组件"}</span>
            </div>
        </button>
    );
}

function HeaderButton({ label, onClick, theme, children }: { label: string; onClick: () => void; theme: CanvasNodeContext["theme"]; children: ReactNode }) {
    return (
        <button
            type="button"
            className="grid size-8 shrink-0 place-items-center rounded-lg transition hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: theme.node.muted }}
            aria-label={label}
            title={label}
            onClick={onClick}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {children}
        </button>
    );
}

function Stat({ icon, label, value, ctx }: { icon: ReactNode; label: string; value: number; ctx: CanvasNodeContext }) {
    return (
        <span className="flex min-w-0 flex-col gap-1 rounded-md px-2 py-2" style={{ background: ctx.theme.toolbar.itemHover }}>
            <span className="flex items-center gap-1 text-[11px]" style={{ color: ctx.theme.node.muted }}>
                {icon}
                {label}
            </span>
            <span className="text-sm font-semibold">{value}</span>
        </span>
    );
}

function readError(error: unknown) {
    const value = error as { response?: { data?: { message?: string } }; message?: string };
    return value.response?.data?.message || value.message || "剧本集加载失败";
}
