import { useEffect, useMemo, useState } from "react";
import { Empty, Input, Select, Tag } from "antd";
import { BookOpenText, Boxes, ChevronLeft, ChevronRight, FileText, Image as ImageIcon, Images, ListTree, Music2, ScanText, Search, Square, Type, Video } from "lucide-react";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { readCanvasHostMessage } from "@/lib/canvas-host-bridge";
import { SUCAI_INTEGRATION } from "@/constant/env";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { cn } from "@/lib/utils";
import { useAssetStore, type Asset, type AssetKind } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { clearCanvasStoreMemory } from "@/stores/canvas/use-canvas-store";
import { clearAssetStoreMemory } from "@/stores/use-asset-store";
import { clearCanvasHostTaskStoreMemory } from "@/stores/canvas/use-canvas-host-task-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import type { InsertAssetPayload } from "./asset-picker-modal";

type PanelTab = "canvas" | "assets";

type Props = {
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    onFocusNode: (nodeId: string) => void;
    onInsertAsset: (payload: InsertAssetPayload) => void;
};

const NODE_TYPE_ICON: Record<string, typeof Square> = {
    [CanvasNodeType.Image]: ImageIcon,
    [CanvasNodeType.Video]: Video,
    [CanvasNodeType.Audio]: Music2,
    [CanvasNodeType.Text]: Type,
    [CanvasNodeType.Group]: Square,
    [CanvasNodeType.ScriptSet]: BookOpenText,
    [CanvasNodeType.AssetExtraction]: ScanText,
    [CanvasNodeType.ScriptAsset]: Boxes,
};

const STATUS_COLOR: Record<string, string> = {
    success: "#22c55e",
    loading: "#f59e0b",
    error: "#ef4444",
    idle: "transparent",
};

export function CanvasSidePanel({ nodes, selectedNodeIds, onFocusNode, onInsertAsset }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [tab, setTab] = useState<PanelTab>("canvas");
    const [open, setOpen] = useState(false);

    const openTab = (nextTab: PanelTab) => {
        setTab(nextTab);
        setOpen(true);
    };

    useEffect(() => {
        if (!SUCAI_INTEGRATION || window.parent === window) return;
        const handleHostMessage = (event: MessageEvent) => {
            if (event.source !== window.parent) return;
            const data = readCanvasHostMessage(event);
            if (!data) return;
            if (data.type === "account-changing") {
                clearCanvasStoreMemory();
                clearAssetStoreMemory();
                clearCanvasHostTaskStoreMemory();
                setOpen(false);
                return;
            }
            if (data.type !== "open-side-panel") return;
            openTab(data.tab as PanelTab);
        };
        window.addEventListener("message", handleHostMessage);
        return () => window.removeEventListener("message", handleHostMessage);
    }, []);

    if (!open) {
        if (SUCAI_INTEGRATION) return null;
        return (
            <aside className="flex h-full w-11 shrink-0 flex-col items-center gap-1 border-r py-2" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} data-canvas-no-zoom>
                <button type="button" onClick={() => openTab("canvas")} className="grid size-9 place-items-center rounded-md opacity-65 transition hover:opacity-100" style={{ background: theme.toolbar.activeBg }} aria-label="展开画布元素" title="展开画布元素">
                    <ListTree className="size-4" />
                </button>
                <button type="button" onClick={() => openTab("assets")} className="grid size-9 place-items-center rounded-md opacity-65 transition hover:opacity-100" aria-label="展开资产" title="展开资产">
                    <Images className="size-4" />
                </button>
            </aside>
        );
    }

    return (
        <aside className="flex h-full w-[260px] shrink-0 flex-col overflow-hidden border-r" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} data-canvas-no-zoom>
            <div className="flex items-center gap-1 px-3 pt-3">
                <TabButton label="画布" active={tab === "canvas"} theme={theme} onClick={() => setTab("canvas")} />
                <TabButton label="资产" active={tab === "assets"} theme={theme} onClick={() => setTab("assets")} />
                <button type="button" onClick={() => setOpen(false)} className="ml-auto grid size-8 place-items-center rounded-md opacity-55 transition hover:opacity-100" aria-label="收起侧栏" title="收起侧栏">
                    <ChevronLeft className="size-4" />
                </button>
            </div>
            <div className="mt-2 min-h-0 flex-1 overflow-hidden">{tab === "canvas" ? <CanvasNodesTab nodes={nodes} selectedNodeIds={selectedNodeIds} onFocusNode={onFocusNode} theme={theme} /> : <CanvasAssetsTab onInsert={onInsertAsset} theme={theme} />}</div>
        </aside>
    );
}

function TabButton({ label, active, theme, onClick }: { label: string; active: boolean; theme: CanvasTheme; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className={cn("rounded-md px-2.5 py-1.5 text-xs font-semibold transition", active ? "" : "opacity-55 hover:opacity-90")} style={active ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { color: theme.node.text }}>
            {label}
        </button>
    );
}

// ---------------------------------------------------------------------------
// 画布 Tab —— 列出节点,点击居中放大并选中
// ---------------------------------------------------------------------------

const NODE_FILTER_OPTIONS = [
    { label: "全部", value: "all" },
    { label: "图片", value: CanvasNodeType.Image },
    { label: "视频", value: CanvasNodeType.Video },
    { label: "文本", value: CanvasNodeType.Text },
    { label: "音频", value: CanvasNodeType.Audio },
    { label: "分组", value: CanvasNodeType.Group },
    { label: "剧本集", value: CanvasNodeType.ScriptSet },
    { label: "资产提取", value: CanvasNodeType.AssetExtraction },
    { label: "资产", value: CanvasNodeType.ScriptAsset },
];

function nodePreviewText(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return getNodeDefinition(node.type)?.title || node.type;
}

function CanvasNodesTab({ nodes, selectedNodeIds, onFocusNode, theme }: { nodes: CanvasNodeData[]; selectedNodeIds: Set<string>; onFocusNode: (nodeId: string) => void; theme: CanvasTheme }) {
    const [keyword, setKeyword] = useState("");
    const [typeFilter, setTypeFilter] = useState<string>("all");

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return nodes.filter((node) => (typeFilter === "all" || node.type === typeFilter) && (!query || [node.title, node.metadata?.content, node.metadata?.prompt].filter(Boolean).join(" ").toLowerCase().includes(query)));
    }, [nodes, keyword, typeFilter]);

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
                <span className="text-xs font-medium opacity-60">画布元素</span>
                {filtered.length ? <span className="text-xs opacity-35">{filtered.length}</span> : null}
                <Select size="small" variant="borderless" className="ml-auto w-20" value={typeFilter} onChange={setTypeFilter} options={NODE_FILTER_OPTIONS} />
            </div>
            <div className="px-3 pb-2.5">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder="搜索节点" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {filtered.length ? (
                    <div className="space-y-1.5">
                        {filtered.map((node) => {
                            const Icon = NODE_TYPE_ICON[node.type] || FileText;
                            const isImage = node.type === CanvasNodeType.Image && node.metadata?.content;
                            const active = selectedNodeIds.has(node.id);
                            return (
                                <button
                                    key={node.id}
                                    type="button"
                                    onClick={() => onFocusNode(node.id)}
                                    className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition", active ? "" : "hover:bg-black/5 dark:hover:bg-white/5")}
                                    style={active ? { background: theme.toolbar.activeBg } : undefined}
                                >
                                    <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md" style={{ background: theme.node.fill }}>
                                        {isImage ? <img src={node.metadata!.content} alt={node.title} className="size-full object-cover" /> : <Icon className="size-4.5 opacity-70" />}
                                    </span>
                                    <span className="min-w-0 flex-1 space-y-0.5">
                                        <span className="block truncate text-xs font-medium leading-snug">{node.title || getNodeDefinition(node.type)?.title || "未命名节点"}</span>
                                        <span className="block truncate text-xs leading-snug opacity-50">{nodePreviewText(node)}</span>
                                    </span>
                                    {node.metadata?.status && node.metadata.status !== "idle" ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[node.metadata.status] || "transparent" }} /> : null}
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <div className="pt-16 text-center text-sm opacity-40">画布暂无节点</div>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// 资产 Tab —— 按类型折叠分组 + 标签筛选,点击插入画布
// ---------------------------------------------------------------------------

const ASSET_GROUPS: { kind: AssetKind; label: string; icon: typeof Square }[] = [
    { kind: "image", label: "图片", icon: ImageIcon },
    { kind: "video", label: "视频", icon: Video },
    { kind: "text", label: "文本", icon: FileText },
];

function buildInsertPayload(asset: Asset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title };
    if (asset.kind === "video") return { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height };
    return { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title };
}

function CanvasAssetsTab({ onInsert, theme }: { onInsert: (payload: InsertAssetPayload) => void; theme: CanvasTheme }) {
    const assets = useAssetStore((state) => state.assets);
    const [keyword, setKeyword] = useState("");
    const [tagFilter, setTagFilter] = useState<string>("all");
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

    const allTags = useMemo(() => Array.from(new Set(assets.flatMap((asset) => asset.tags || []))).slice(0, 20), [assets]);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets.filter((asset) => (tagFilter === "all" || (asset.tags || []).includes(tagFilter)) && (!query || [asset.title, ...(asset.tags || [])].join(" ").toLowerCase().includes(query)));
    }, [assets, keyword, tagFilter]);

    const groups = useMemo(() => ASSET_GROUPS.map((group) => ({ ...group, items: filtered.filter((asset) => asset.kind === group.kind) })).filter((group) => group.items.length > 0), [filtered]);

    return (
        <div className="flex h-full flex-col">
            <div className="px-3 pb-2">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder="搜索资产" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            {allTags.length ? (
                <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                    <Tag.CheckableTag checked={tagFilter === "all"} className={cn("prompt-filter-tag", tagFilter === "all" && "is-active")} onChange={() => setTagFilter("all")}>
                        全部
                    </Tag.CheckableTag>
                    {allTags.map((tag) => (
                        <Tag.CheckableTag key={tag} checked={tagFilter === tag} className={cn("prompt-filter-tag", tagFilter === tag && "is-active")} onChange={() => setTagFilter((prev) => (prev === tag ? "all" : tag))}>
                            {tag}
                        </Tag.CheckableTag>
                    ))}
                </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {groups.length ? (
                    <div className="space-y-1">
                        {groups.map((group) => {
                            const isCollapsed = collapsed[group.kind];
                            return (
                                <div key={group.kind}>
                                    <button type="button" onClick={() => setCollapsed((prev) => ({ ...prev, [group.kind]: !prev[group.kind] }))} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold opacity-75 transition hover:opacity-100">
                                        <ChevronRight className={cn("size-3.5 transition-transform", !isCollapsed && "rotate-90")} />
                                        <group.icon className="size-3.5" />
                                        <span>{group.label}</span>
                                        <span className="opacity-50">{group.items.length}</span>
                                    </button>
                                    {isCollapsed ? null : (
                                        <div className="grid grid-cols-2 gap-2 px-1 pb-2 pt-1">
                                            {group.items.map((asset) => (
                                                <AssetCard key={asset.id} asset={asset} theme={theme} onClick={() => onInsert(buildInsertPayload(asset))} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无资产" className="pt-16" />
                )}
            </div>
        </div>
    );
}

function AssetCard({ asset, theme, onClick }: { asset: Asset; theme: CanvasTheme; onClick: () => void }) {
    const cover = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    return (
        <button type="button" onClick={onClick} className="group relative overflow-hidden rounded-lg border text-left transition hover:shadow-md" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
            {cover ? <img src={cover} alt={asset.title} className="aspect-square w-full object-cover" /> : <div className="flex aspect-square items-center justify-center p-2 text-center text-[11px] leading-4 opacity-60">{asset.title}</div>}
            <div className="truncate px-2 py-1.5 text-[11px] font-medium">{asset.title}</div>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-950/0 text-xs font-medium text-white opacity-0 transition group-hover:bg-stone-950/55 group-hover:opacity-100">插入</div>
        </button>
    );
}
