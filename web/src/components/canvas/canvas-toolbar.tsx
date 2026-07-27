import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { Button, Segmented, Switch } from "antd";
import {
    BookOpenText,
    Check,
    CircleDot,
    Clapperboard,
    Eraser,
    Grid2x2,
    Group,
    Hand,
    Image as ImageIcon,
    Info,
    LayoutGrid,
    LoaderCircle,
    Mic2,
    Moon,
    Palette,
    Puzzle,
    Redo2,
    Settings2,
    Square,
    Sun,
    Trash2,
    TriangleAlert,
    Type,
    Undo2,
    Upload,
    Video,
} from "lucide-react";

import { canvasThemes, type CanvasBackgroundMode, type CanvasColorTheme, type CanvasTheme } from "@/lib/canvas-theme";
import { getNodePluginId, listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { useThemeStore } from "@/stores/use-theme-store";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { useCanvasPersistenceStatus } from "@/stores/canvas/use-canvas-store";

const SHOW_PLUGIN_UI = import.meta.env.VITE_SHOW_CANVAS_PLUGIN_UI !== "false";

const TOOL_ACCENTS = {
    stone: { light: "#57534e", dark: "#d6d3d1", rgb: "120,113,108" },
    sky: { light: "#0284c7", dark: "#38bdf8", rgb: "14,165,233" },
    violet: { light: "#7c3aed", dark: "#a78bfa", rgb: "139,92,246" },
    emerald: { light: "#059669", dark: "#34d399", rgb: "16,185,129" },
    cyan: { light: "#0891b2", dark: "#22d3ee", rgb: "6,182,212" },
    rose: { light: "#e11d48", dark: "#fb7185", rgb: "244,63,94" },
    amber: { light: "#d97706", dark: "#fbbf24", rgb: "245,158,11" },
    indigo: { light: "#4f46e5", dark: "#818cf8", rgb: "99,102,241" },
    fuchsia: { light: "#c026d3", dark: "#e879f9", rgb: "217,70,239" },
} as const;

type ToolbarAccent = keyof typeof TOOL_ACCENTS;

const TOOL_ACCENT_BY_ID: Record<string, ToolbarAccent> = {
    "tool-hand": "sky",
    "tool-undo": "violet",
    "tool-redo": "violet",
    "tool-text": "indigo",
    "tool-image": "emerald",
    "tool-video": "cyan",
    "tool-audio": "rose",
    "tool-config": "amber",
    "tool-group": "violet",
    "tool-script-set": "amber",
    "tool-storyboard": "rose",
    "tool-storyboard-grid": "cyan",
    "tool-extensions": "violet",
    "tool-upload": "sky",
    "tool-style": "fuchsia",
};

export function CanvasToolbar({
    selectedCount,
    canUndo,
    canRedo,
    backgroundMode,
    showImageInfo,
    onAddImage,
    onAddVideo,
    onAddAudio,
    onAddText,
    onAddConfig,
    onAddGroup,
    onAddScriptSet,
    onAddStoryboard,
    onAddStoryboardGrid,
    onAddExtensionNode,
    onUndo,
    onRedo,
    onUpload,
    onDelete,
    onClear,
    onDeselect,
    onBackgroundModeChange,
    onShowImageInfoChange,
}: {
    selectedCount: number;
    canUndo: boolean;
    canRedo: boolean;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    onAddImage: () => void;
    onAddVideo: () => void;
    onAddAudio: () => void;
    onAddText: () => void;
    onAddConfig: () => void;
    onAddGroup: () => void;
    onAddScriptSet: () => void;
    onAddStoryboard: () => void;
    onAddStoryboardGrid: () => void;
    onAddExtensionNode: (type: string) => void;
    onUndo: () => void;
    onRedo: () => void;
    onUpload: () => void;
    onDelete: () => void;
    onClear: () => void;
    onDeselect: () => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void;
}) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const colorTheme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const theme = canvasThemes[colorTheme];
    const [hovered, setHovered] = useState<string | null>(null);
    const [tipX, setTipX] = useState(0);
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const [panelX, setPanelX] = useState(0);
    const [extensionsOpen, setExtensionsOpen] = useState(false);
    const [extPanelX, setExtPanelX] = useState(0);
    const saveStatus = useCanvasPersistenceStatus((state) => state.status);
    const saveError = useCanvasPersistenceStatus((state) => state.error);
    // 扩展(插件)节点,随注册表变化实时更新
    useNodeRegistryVersion();
    const extensionDefs = SHOW_PLUGIN_UI ? listNodeDefinitions().filter((def) => def.showInCreateMenu !== false && getNodePluginId(def.type) !== "builtin") : [];
    const dockStyle = {
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
        color: theme.toolbar.item,
        boxShadow: colorTheme === "dark" ? "0 20px 52px rgba(0,0,0,.42), 0 0 28px rgba(14,165,233,.06), 0 0 44px rgba(139,92,246,.05)" : "0 18px 46px rgba(28,25,23,.14), 0 0 24px rgba(14,165,233,.05), 0 0 36px rgba(139,92,246,.04)",
    };
    const saveAccent = saveStatus === "error" ? TOOL_ACCENTS.rose : saveStatus === "saving" ? TOOL_ACCENTS.amber : TOOL_ACCENTS.emerald;
    const saveColor = colorTheme === "dark" ? saveAccent.dark : saveAccent.light;
    const tip = hovered ? toolLabel(hovered) : "";

    // 点击工具栏(含弹出面板)以外的地方,关闭弹出的扩展节点/画布外观面板
    useEffect(() => {
        if (!extensionsOpen && !appearanceOpen) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                setExtensionsOpen(false);
                setAppearanceOpen(false);
            }
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [extensionsOpen, appearanceOpen]);

    return (
        <div ref={rootRef} className="pointer-events-none absolute bottom-5 z-50 flex justify-center" style={{ left: 300, right: 16 }}>
            {tip ? <DockTip label={tip} x={tipX} theme={theme} /> : null}
            <div ref={wrapRef} className="thin-scrollbar pointer-events-auto flex h-14 max-w-full items-center gap-1 overflow-x-auto rounded-xl border px-2 shadow-lg backdrop-blur [&>*]:shrink-0" style={dockStyle}>
                <span
                    className="inline-flex h-8 w-[76px] items-center justify-center gap-1 rounded-lg border text-[11px] font-medium transition-colors"
                    style={{ color: saveColor, background: `rgba(${saveAccent.rgb},.08)`, borderColor: `rgba(${saveAccent.rgb},.16)` }}
                    title={saveStatus === "error" ? saveError || "画布保存失败" : saveStatus === "saving" ? "正在保存画布" : "画布已保存到本地"}
                >
                    {saveStatus === "saving" ? <LoaderCircle className="size-3 animate-spin" /> : saveStatus === "error" ? <TriangleAlert className="size-3 text-red-400" /> : <Check className="size-3" />}
                    {saveStatus === "saving" ? "保存中" : saveStatus === "error" ? "保存失败" : "已保存"}
                </span>
                <Divider theme={theme} />
                <ToolbarButton id="tool-hand" label="移动/选择" active={!selectedCount} hovered={hovered} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onDeselect}>
                    <Hand className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-undo" label="撤销" disabled={!canUndo} hovered={hovered} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onUndo}>
                    <Undo2 className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-redo" label="重做" disabled={!canRedo} hovered={hovered} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onRedo}>
                    <Redo2 className="size-4.5" />
                </ToolbarButton>
                <Divider theme={theme} />
                <ToolbarButton id="tool-text" label="文本" hovered={hovered} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddText}>
                    <Type className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-image" label="图片" hovered={hovered} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddImage}>
                    <ImageIcon className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-video" label="视频" hovered={hovered} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddVideo}>
                    <Video className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-audio" label="配音" hovered={hovered} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddAudio}>
                    <Mic2 className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-config" label="生成配置" hovered={hovered} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddConfig}>
                    <Settings2 className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-group" label="组" hovered={hovered} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddGroup}>
                    <Group className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-script-set" label="剧本集" hovered={hovered} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddScriptSet}>
                    <BookOpenText className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-storyboard" label="分镜脚本" hovered={hovered} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddStoryboard}>
                    <Clapperboard className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-storyboard-grid" label="九宫格分镜" hovered={hovered} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddStoryboardGrid}>
                    <LayoutGrid className="size-4.5" />
                </ToolbarButton>
                {extensionDefs.length ? (
                    <ToolbarButton
                        id="tool-extensions"
                        label="扩展节点"
                        active={extensionsOpen}
                        hovered={hovered}
                        wrapRef={wrapRef}
                        onTipX={setTipX}
                        onHover={setHovered}
                        onClick={(event) => {
                            setExtPanelX(getTipX(wrapRef.current, event.currentTarget));
                            setAppearanceOpen(false);
                            setExtensionsOpen((value) => !value);
                        }}
                    >
                        <Puzzle className="size-4.5" />
                    </ToolbarButton>
                ) : null}
                <ToolbarButton id="tool-upload" label="上传资产" hovered={hovered} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onUpload}>
                    <Upload className="size-4.5" />
                </ToolbarButton>
                <Divider theme={theme} />
                <ToolbarButton
                    id="tool-style"
                    label="画布外观"
                    active={appearanceOpen}
                    hovered={hovered}
                    wrapRef={wrapRef}
                    onTipX={setTipX}
                    onHover={setHovered}
                    onClick={(event) => {
                        setPanelX(getTipX(wrapRef.current, event.currentTarget));
                        setExtensionsOpen(false);
                        setAppearanceOpen((value) => !value);
                    }}
                >
                    <Palette className="size-4.5" />
                </ToolbarButton>
                {selectedCount ? (
                    <>
                        <Divider theme={theme} />
                        <ToolbarButton id="tool-delete" label="删除选中" hovered={hovered} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onDelete} danger>
                            <Trash2 className="size-4.5" />
                        </ToolbarButton>
                    </>
                ) : null}
                <Divider theme={theme} />
                <ToolbarButton id="tool-clear" label="清空画布" hovered={hovered} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onClear} danger>
                    <Eraser className="size-4.5" />
                </ToolbarButton>
            </div>

            {extensionsOpen && extensionDefs.length ? (
                <div
                    className="thin-scrollbar pointer-events-auto absolute bottom-[72px] z-30 max-h-[50vh] w-[240px] -translate-x-1/2 overflow-y-auto rounded-xl border p-2 shadow-xl backdrop-blur"
                    style={{ left: extPanelX || "50%", background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                >
                    <div className="px-1.5 pb-1.5 text-[11px] font-medium opacity-50">扩展节点</div>
                    <div className="grid gap-0.5">
                        {extensionDefs.map((def) => (
                            <button
                                key={def.type}
                                type="button"
                                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition"
                                style={{ color: theme.toolbar.item }}
                                onMouseEnter={(event) => (event.currentTarget.style.background = theme.toolbar.itemHover)}
                                onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
                                onClick={() => {
                                    onAddExtensionNode(def.type);
                                    setExtensionsOpen(false);
                                }}
                            >
                                <span className="grid size-7 shrink-0 place-items-center rounded-md text-base" style={{ background: theme.toolbar.itemHover }}>
                                    {def.icon}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{def.title}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}

            {appearanceOpen ? (
                <div
                    className="pointer-events-auto absolute bottom-[72px] z-30 w-[248px] -translate-x-1/2 rounded-xl border p-2.5 shadow-xl backdrop-blur"
                    style={{ left: panelX || "50%", background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                >
                    <div className="px-1 pb-2 text-sm font-medium opacity-65">画布外观</div>
                    <div className="px-1 pb-1.5 text-[11px] font-medium opacity-50">主题模式</div>
                    <div className="grid grid-cols-2 gap-1 rounded-lg p-1" style={{ background: theme.toolbar.itemHover }}>
                        <CanvasThemeButton colorTheme={colorTheme} targetTheme="light" onThemeChange={setTheme}>
                            <Sun className="size-4" />
                            浅色
                        </CanvasThemeButton>
                        <CanvasThemeButton colorTheme={colorTheme} targetTheme="dark" onThemeChange={setTheme}>
                            <Moon className="size-4" />
                            深色
                        </CanvasThemeButton>
                    </div>
                    <div className="mt-3 px-1 pb-1.5 text-[11px] font-medium opacity-50">网格样式</div>
                    <Segmented
                        className="w-full !p-1 [&_.ant-segmented-group]:!flex [&_.ant-segmented-item]:!min-h-8 [&_.ant-segmented-item]:!flex-1 [&_.ant-segmented-item-label]:!min-h-8 [&_.ant-segmented-item-label]:!leading-8"
                        value={backgroundMode}
                        onChange={(value) => onBackgroundModeChange(value as CanvasBackgroundMode)}
                        options={[
                            {
                                value: "dots",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <CircleDot className="size-4" />点
                                    </span>
                                ),
                            },
                            {
                                value: "lines",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Grid2x2 className="size-4" />线
                                    </span>
                                ),
                            },
                            {
                                value: "blank",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Square className="size-4" />
                                        空白
                                    </span>
                                ),
                            },
                        ]}
                    />
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg px-1.5 py-1">
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium opacity-65">
                            <Info className="size-3.5" />
                            图片信息
                        </span>
                        <Switch size="small" checked={showImageInfo} onChange={onShowImageInfoChange} />
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function ToolbarButton({
    id,
    label,
    active,
    hovered,
    wrapRef,
    onTipX,
    onHover,
    onClick,
    disabled = false,
    danger = false,
    children,
}: {
    id: string;
    label: string;
    active?: boolean;
    hovered: string | null;
    wrapRef: RefObject<HTMLDivElement | null>;
    onTipX: (x: number) => void;
    onHover: (id: string | null) => void;
    onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
    disabled?: boolean;
    danger?: boolean;
    children: ReactNode;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const accent = TOOL_ACCENTS[danger ? "rose" : TOOL_ACCENT_BY_ID[id] || "stone"];
    const accentColor = colorTheme === "dark" ? accent.dark : accent.light;
    const isHovered = hovered === id && !disabled;
    const buttonStyle: CSSProperties = {
        color: accentColor,
        opacity: disabled ? 0.28 : 1,
        background: disabled ? "transparent" : `rgba(${accent.rgb},${active ? 0.22 : isHovered ? 0.17 : 0.07})`,
        borderColor: disabled ? "transparent" : `rgba(${accent.rgb},${active ? 0.34 : isHovered ? 0.26 : 0.08})`,
        boxShadow: disabled ? "none" : active ? `0 0 0 1px rgba(${accent.rgb},.12), 0 8px 22px rgba(${accent.rgb},.16)` : isHovered ? `0 7px 18px rgba(${accent.rgb},.14)` : "none",
        transform: isHovered ? "translateY(-1px)" : "translateY(0)",
    };

    return (
        <Button
            type="text"
            aria-label={label}
            className="!h-9 !w-9 !min-w-9 !rounded-lg !border !border-solid !p-0 !transition-all !duration-200"
            disabled={disabled}
            style={buttonStyle}
            icon={children}
            onMouseEnter={(event) => {
                onHover(id);
                onTipX(getTipX(wrapRef.current, event.currentTarget));
            }}
            onMouseLeave={() => onHover(null)}
            onClick={onClick}
        />
    );
}

function Divider({ theme }: { theme: CanvasTheme }) {
    return <div className="mx-1 h-6 w-px" style={{ background: theme.toolbar.border }} />;
}

function CanvasThemeButton({ colorTheme, targetTheme, onThemeChange, children }: { colorTheme: CanvasColorTheme; targetTheme: CanvasColorTheme; onThemeChange: (theme: CanvasColorTheme) => void; children: ReactNode }) {
    const theme = canvasThemes[colorTheme];
    const active = colorTheme === targetTheme;
    const activeStyle = colorTheme === "light" ? { background: "#111111", color: "#ffffff" } : { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };

    return (
        <AnimatedThemeToggler
            theme={colorTheme}
            targetTheme={targetTheme}
            onThemeChange={onThemeChange}
            className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm transition"
            style={active ? activeStyle : { color: theme.toolbar.item }}
            aria-label={`切换到${targetTheme === "dark" ? "深色" : "浅色"}主题`}
            title={`切换到${targetTheme === "dark" ? "深色" : "浅色"}主题`}
        >
            {children}
        </AnimatedThemeToggler>
    );
}

function DockTip({ label, x, theme }: { label: string; x: number; theme: CanvasTheme }) {
    return (
        <span className="absolute bottom-[calc(100%+8px)] -translate-x-1/2 rounded-md px-2 py-1 text-xs shadow-lg" style={{ left: x, background: theme.node.text, color: theme.node.panel }}>
            {label}
        </span>
    );
}

function toolLabel(id: string) {
    if (id === "tool-hand") return "移动/选择";
    if (id === "tool-undo") return "撤销";
    if (id === "tool-redo") return "重做";
    if (id === "tool-text") return "文本";
    if (id === "tool-image") return "图片";
    if (id === "tool-video") return "视频";
    if (id === "tool-audio") return "配音";
    if (id === "tool-config") return "生成配置";
    if (id === "tool-group") return "组";
    if (id === "tool-script-set") return "剧本集";
    if (id === "tool-extensions") return "扩展节点";
    if (id === "tool-upload") return "上传资产";
    if (id === "tool-style") return "画布外观";
    if (id === "tool-delete") return "删除选中";
    if (id === "tool-clear") return "清空画布";
    return "";
}

function getTipX(wrap: HTMLDivElement | null, target: HTMLElement) {
    if (!wrap) return 0;
    const wrapBox = wrap.parentElement?.getBoundingClientRect() || wrap.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    return box.left - wrapBox.left + box.width / 2;
}
