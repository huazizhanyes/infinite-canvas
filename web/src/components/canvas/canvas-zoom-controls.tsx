import type { ReactNode } from "react";
import { Compass, Focus, FolderOpen, HelpCircle, Image as ImageIcon, LayoutTemplate } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Modal, Tooltip } from "antd";

import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_TEMPLATES, type CanvasTemplateId } from "@/lib/canvas/canvas-templates";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasZoomControlsProps = {
    scale: number;
    onScaleChange: (scale: number) => void;
    onReset: () => void;
    isMiniMapOpen: boolean;
    onToggleMiniMap: () => void;
    onOpenAssets: () => void;
    onCreateTemplate: (templateId: CanvasTemplateId) => void;
};

export function CanvasZoomControls({ scale, onScaleChange, onReset, isMiniMapOpen, onToggleMiniMap, onOpenAssets, onCreateTemplate }: CanvasZoomControlsProps) {
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [templatesOpen, setTemplatesOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const dockStyle = { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item, boxShadow: colorTheme === "dark" ? "0 18px 45px rgba(0,0,0,.32)" : "0 16px 40px rgba(28,25,23,.12)" };
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };

    useEffect(() => {
        if (!templatesOpen) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) setTemplatesOpen(false);
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [templatesOpen]);

    return (
        <div ref={rootRef} className="absolute bottom-4 left-4 z-50 flex items-center gap-2" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <div className="flex h-12 items-center gap-1 rounded-lg border px-1.5 shadow-lg backdrop-blur" style={dockStyle}>
                <Tooltip title={isMiniMapOpen ? "关闭小地图" : "打开小地图"}>
                    <Button
                        type="text"
                        className="!h-8 !w-8 !min-w-8 !p-0"
                        style={isMiniMapOpen ? activeStyle : { color: theme.toolbar.item }}
                        icon={<Compass className="size-4" />}
                        onClick={onToggleMiniMap}
                        aria-label={isMiniMapOpen ? "关闭小地图" : "打开小地图"}
                    />
                </Tooltip>
                <Tooltip title="重置视图">
                    <Button type="text" className="!h-8 !w-8 !min-w-8 !p-0" style={{ color: theme.toolbar.item }} icon={<Focus className="size-4" />} onClick={onReset} aria-label="重置视图" />
                </Tooltip>
                <Tooltip title="放大/缩小画布">
                    <input
                        type="range"
                        min="5"
                        max="500"
                        step="1"
                        value={Math.round(scale * 100)}
                        className="w-24"
                        style={{ accentColor: theme.node.activeStroke }}
                        onChange={(event) => onScaleChange(Number(event.target.value) / 100)}
                        aria-label="放大/缩小画布"
                    />
                </Tooltip>
                <span className="w-10 text-right text-xs tabular-nums" style={{ color: theme.node.muted }}>
                    {Math.round(scale * 100)}%
                </span>
                <Tooltip title="快捷键">
                    <Button type="text" className="!h-8 !w-8 !min-w-8 !p-0" style={shortcutsOpen ? activeStyle : { color: theme.toolbar.item }} icon={<HelpCircle className="size-4" />} onClick={() => setShortcutsOpen(true)} aria-label="快捷键" />
                </Tooltip>
            </div>
            <Tooltip title="资产库">
                <Button
                    type="text"
                    className="!h-12 !min-w-12 !rounded-lg !border !px-3 !shadow-lg !backdrop-blur"
                    style={{ ...dockStyle, color: theme.toolbar.item }}
                    icon={<FolderOpen className="size-4" />}
                    onClick={onOpenAssets}
                    aria-label="资产库"
                >
                    <span className="ml-1 text-xs">资产库</span>
                </Button>
            </Tooltip>
            <div className="relative">
                <Tooltip title="模板">
                    <Button
                        type="text"
                        className="!h-12 !min-w-12 !rounded-lg !border !px-3 !shadow-lg !backdrop-blur"
                        style={{ ...dockStyle, color: theme.toolbar.item, ...(templatesOpen ? activeStyle : {}) }}
                        icon={<LayoutTemplate className="size-4" />}
                        onClick={() => setTemplatesOpen((value) => !value)}
                        aria-label="模板"
                    >
                        <span className="ml-1 text-xs">模板</span>
                    </Button>
                </Tooltip>
                {templatesOpen ? (
                    <div
                        className="thin-scrollbar pointer-events-auto absolute bottom-[calc(100%+8px)] left-0 z-50 max-h-[60vh] w-[184px] overflow-y-auto rounded-xl border p-2 shadow-xl backdrop-blur"
                        style={{ background: "rgba(15, 23, 42, .97)", borderColor: "rgba(255,255,255,.18)", color: "#ffffff" }}
                    >
                        <div className="px-1.5 pb-2">
                            <div className="text-sm font-semibold">模板</div>
                        </div>
                        <div className="grid gap-1">
                            {CANVAS_TEMPLATES.map((template) => (
                                <button
                                    key={template.id}
                                    type="button"
                                    className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition"
                                    style={{ color: theme.toolbar.item }}
                                    onMouseEnter={(event) => (event.currentTarget.style.background = theme.toolbar.itemHover)}
                                    onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
                                    onClick={() => {
                                        onCreateTemplate(template.id);
                                        setTemplatesOpen(false);
                                    }}
                                >
                                    <span className="grid size-8 shrink-0 place-items-center rounded-md" style={{ background: theme.toolbar.itemHover }}>
                                        {template.kind === "video" ? <LayoutTemplate className="size-4" /> : <ImageIcon className="size-4" />}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-medium">{template.title}</span>
                                        {template.description ? <span className="mt-0.5 block text-[11px] leading-4 opacity-55">{template.description}</span> : null}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>
            <Modal title="快捷键" open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-3 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut label="拖动画布" value="平移视图" />
                    <Shortcut label="滚轮" value="缩放画布" />
                    <Shortcut label="Ctrl / Cmd + 拖动" value="框选多个节点" />
                    <Shortcut label="Shift / Ctrl / Cmd + 点击" value="追加选择节点" />
                    <Shortcut label="多选后拖动" value="整组移动节点" />
                    <Shortcut label="多选后整理" value="工具栏“整理选中”" />
                    <Shortcut label="Ctrl / Cmd + C / V" value="复制 / 粘贴节点" />
                    <Shortcut label="Delete / Backspace" value="删除选中" />
                </div>
            </Modal>
        </div>
    );
}

function Shortcut({ label, value }: { label: ReactNode; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="text-base font-medium">{label}</span>
            <span className="opacity-60">{value}</span>
        </div>
    );
}
