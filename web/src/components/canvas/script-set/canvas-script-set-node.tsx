import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BookOpenText, Boxes, LoaderCircle, UsersRound } from "lucide-react";

import { canvasScriptApi, type ScriptSet } from "@/services/api/canvas-script";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

export function CanvasScriptSetNode({ ctx }: { ctx: CanvasNodeContext }) {
    const connection = useUserStore((state) => state.connection);
    const scriptSetId = ctx.node.metadata?.scriptSetId;
    const [scriptSet, setScriptSet] = useState<ScriptSet | null>(null);
    const [loading, setLoading] = useState(Boolean(scriptSetId));

    const load = useCallback(async () => {
        if (!connection || !scriptSetId) return;
        setLoading(true);
        try {
            setScriptSet(await canvasScriptApi.getSet(connection, scriptSetId));
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

    const open = () => window.dispatchEvent(new CustomEvent("canvas-script-set-open", { detail: { nodeId: ctx.node.id } }));
    const stats = scriptSet?.stats;

    return (
        <button
            type="button"
            className="flex h-full w-full flex-col overflow-hidden p-4 text-left"
            style={{ color: ctx.theme.node.text }}
            onClick={(event) => {
                event.stopPropagation();
                open();
            }}
        >
            <div className="flex w-full items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-md" style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.toolbar.activeText }}>
                    <BookOpenText className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{scriptSet?.title || ctx.node.title}</span>
                    <span className="mt-0.5 block text-xs" style={{ color: ctx.theme.node.muted }}>
                        {scriptSetId ? (loading ? "正在读取资产..." : "点击管理剧集与资产") : "正在初始化剧本集..."}
                    </span>
                </span>
                {loading ? <LoaderCircle className="size-4 animate-spin" style={{ color: ctx.theme.node.muted }} /> : null}
            </div>
            <div className="mt-4 grid w-full grid-cols-3 gap-2">
                <Stat icon={<BookOpenText className="size-3.5" />} label="剧集" value={stats?.episodeCount || 0} ctx={ctx} />
                <Stat icon={<UsersRound className="size-3.5" />} label="人物" value={stats?.assetCounts.character || 0} ctx={ctx} />
                <Stat icon={<Boxes className="size-3.5" />} label="资产" value={(stats?.assetCounts.scene || 0) + (stats?.assetCounts.prop || 0)} ctx={ctx} />
            </div>
            <div className="mt-auto flex w-full items-center justify-between pt-3 text-xs" style={{ color: ctx.theme.node.muted }}>
                <span>待确认 {stats?.pendingCount || 0}</span>
                <span>场景 {stats?.assetCounts.scene || 0} · 道具 {stats?.assetCounts.prop || 0}</span>
            </div>
        </button>
    );
}

function Stat({ icon, label, value, ctx }: { icon: ReactNode; label: string; value: number; ctx: CanvasNodeContext }) {
    return (
        <span className="flex min-w-0 flex-col gap-1 rounded-md px-2 py-2" style={{ background: ctx.theme.toolbar.itemHover }}>
            <span className="flex items-center gap-1 text-[11px]" style={{ color: ctx.theme.node.muted }}>{icon}{label}</span>
            <span className="text-base font-semibold">{value}</span>
        </span>
    );
}
