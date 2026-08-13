import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight, Group, Image as ImageIcon, Maximize2, Music2, Puzzle, RefreshCw, Search, Star, Video, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes } from "@/lib/image-utils";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasNodeType, type CanvasNodeData, type Position } from "@/types/canvas";
import type { CanvasNodeContext, CanvasPluginHost } from "@/types/canvas-plugin";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

function screenUiScale(scale: number) {
    return 1 / Math.max(1, scale / 1.25);
}

function screenFixedScale(scale: number) {
    return 1 / Math.max(scale, 0.05);
}

type CanvasNodeProps = {
    data: CanvasNodeData;
    scale: number;
    isSelected: boolean;
    isRelated: boolean;
    isFocusRelated: boolean;
    isConnectionTarget: boolean;
    isConnecting: boolean;
    editRequestNonce?: number;
    showPanel: boolean;
    showImageInfo: boolean;
    resourceLabel?: CanvasResourceReference;
    mentionReferences?: CanvasResourceReference[];
    pluginHost?: CanvasPluginHost;
    registryVersion?: number;
    renderPanel?: (node: CanvasNodeData) => ReactNode;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    batchCount?: number;
    groupChildCount?: number;
    isGroupDropTarget?: boolean;
    batchExpanded?: boolean;
    batchClosing?: boolean;
    batchOpening?: boolean;
    batchRecovering?: boolean;
    batchMotion?: { x: number; y: number; index: number };
    onMouseDown: (event: React.MouseEvent, nodeId: string) => void;
    onSelectCapture?: (event: React.MouseEvent, nodeId: string) => void;
    onHoverStart: (nodeId: string) => void;
    onHoverEnd: (nodeId: string) => void;
    onConnectStart: (event: React.MouseEvent, nodeId: string, handleType: "source" | "target") => void;
    onResize: (nodeId: string, width: number, height: number, position?: Position) => void;
    onContentChange: (nodeId: string, content: string) => void;
    onTextSelectionChange?: (nodeId: string, selectedText: string) => void;
    onOpenPanel?: (nodeId: string) => void;
    onTitleChange: (nodeId: string, title: string) => void;
    onToggleBatch?: (nodeId: string) => void;
    onSetBatchPrimary?: (node: CanvasNodeData) => void;
    onRetry?: (node: CanvasNodeData) => void;
    onViewImage?: (node: CanvasNodeData) => void;
    onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
};

type NodeContentRendererProps = {
    node: CanvasNodeData;
    scale: number;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    isEditingContent: boolean;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    textContentRef: React.RefObject<HTMLDivElement | null>;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    pluginContext?: CanvasNodeContext | null;
    onContentChange: (nodeId: string, content: string) => void;
    onTextSelectionChange?: (nodeId: string, selectedText: string) => void;
    onOpenPanel?: (nodeId: string) => void;
    onStopEditing: () => void;
    mentionReferences: CanvasResourceReference[];
    onRetry?: (node: CanvasNodeData) => void;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: () => void;
    groupChildCount: number;
};

export const CanvasNode = React.memo(function CanvasNode({
    data,
    scale,
    isSelected,
    isRelated,
    isFocusRelated,
    isConnectionTarget,
    isConnecting,
    editRequestNonce = 0,
    showPanel,
    showImageInfo,
    resourceLabel,
    mentionReferences = [],
    pluginHost,
    renderPanel,
    renderNodeContent,
    batchCount = 0,
    groupChildCount = 0,
    isGroupDropTarget = false,
    batchExpanded = false,
    batchClosing = false,
    batchOpening = false,
    batchRecovering = false,
    batchMotion,
    onMouseDown,
    onSelectCapture,
    onHoverStart,
    onHoverEnd,
    onConnectStart,
    onResize,
    onContentChange,
    onTextSelectionChange,
    onOpenPanel,
    onTitleChange,
    onToggleBatch,
    onSetBatchPrimary,
    onRetry,
    onViewImage,
    onContextMenu,
}: CanvasNodeProps) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const selectionWhite = "#ffffff";
    const [hovered, setHovered] = useState(false);
    const definition = getNodeDefinition(data.type);
    const pluginContext = useMemo<CanvasNodeContext | null>(() => (pluginHost ? buildNodeContext(pluginHost, data, theme, scale, isSelected) : null), [pluginHost, data, theme, scale, isSelected]);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(data.title || "");
    const hasImageContent = data.type === CanvasNodeType.Image && Boolean(data.metadata?.content);
    const hasVideoContent = data.type === CanvasNodeType.Video && Boolean(data.metadata?.content);
    const hasAudioContent = data.type === CanvasNodeType.Audio && Boolean(data.metadata?.content);
    const isGroup = data.type === CanvasNodeType.Group;
    const isBatchRoot = data.type === CanvasNodeType.Image && Boolean(data.metadata?.isBatchRoot) && batchCount > 1 && !data.metadata?.storyboardGridNodeId;
    const isBatchChild = data.type === CanvasNodeType.Image && Boolean(data.metadata?.batchRootId);
    const isActive = isConnectionTarget || isSelected || isFocusRelated;
    const imageBorderColor = isActive ? selectionWhite : isRelated && !isBatchChild ? theme.node.muted : "transparent";
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const textContentRef = useRef<HTMLDivElement>(null);
    const titleInputRef = useRef<HTMLInputElement>(null);
    const resizeRef = useRef({
        isResizing: false,
        corner: "bottom-right" as ResizeCorner,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0,
        startWidth: 0,
        startHeight: 0,
        keepRatio: false,
        ratio: 1,
    });

    useEffect(() => {
        setTitleDraft(data.title || "");
    }, [data.title]);

    useEffect(() => {
        if (!isEditingTitle) return;
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
    }, [isEditingTitle]);

    const finishTitleEditing = useCallback(() => {
        const title = titleDraft.trim() || data.title || "未命名节点";
        setTitleDraft(title);
        setIsEditingTitle(false);
        if (title !== data.title) onTitleChange(data.id, title);
    }, [data.id, data.title, onTitleChange, titleDraft]);

    useEffect(() => {
        if (!isEditingTitle) return;
        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && titleInputRef.current?.contains(target)) return;
            finishTitleEditing();
        };
        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [finishTitleEditing, isEditingTitle]);

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const handleWheel = (event: WheelEvent) => event.stopPropagation();
        textarea.addEventListener("wheel", handleWheel, { passive: false });
        return () => textarea.removeEventListener("wheel", handleWheel);
    }, [data.type, isEditingContent]);

    useEffect(() => {
        if (!isEditingContent) return;
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    }, [isEditingContent]);

    useEffect(() => {
        if (!editRequestNonce || data.type !== CanvasNodeType.Text) return;
        setIsEditingContent(true);
    }, [data.type, editRequestNonce]);

    useEffect(() => {
        if (!isEditingContent) return;

        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (isEditingContent && textareaRef.current?.contains(target)) return;

            setIsEditingContent(false);
        };

        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [isEditingContent]);

    const handleResizeMove = useCallback(
        (event: MouseEvent) => {
            if (!resizeRef.current.isResizing) return;

            const dx = (event.clientX - resizeRef.current.startX) / scale;
            const dy = (event.clientY - resizeRef.current.startY) / scale;
            const minWidth = 220;
            const minHeight = 160;
            const startRight = resizeRef.current.startLeft + resizeRef.current.startWidth;
            const startBottom = resizeRef.current.startTop + resizeRef.current.startHeight;
            const fromLeft = resizeRef.current.corner.includes("left");
            const fromTop = resizeRef.current.corner.includes("top");
            const rawWidth = Math.max(minWidth, resizeRef.current.startWidth + (fromLeft ? -dx : dx));
            const rawHeight = Math.max(minHeight, resizeRef.current.startHeight + (fromTop ? -dy : dy));
            let width = rawWidth;
            let height = rawHeight;
            if (resizeRef.current.keepRatio) {
                const ratio = resizeRef.current.ratio;
                if (Math.abs(dx) >= Math.abs(dy)) {
                    height = width / ratio;
                } else {
                    width = height * ratio;
                }
                if (height < minHeight) {
                    height = minHeight;
                    width = height * ratio;
                }
                if (width < minWidth) {
                    width = minWidth;
                    height = width / ratio;
                }
            }

            onResize(data.id, width, height, {
                x: fromLeft ? startRight - width : resizeRef.current.startLeft,
                y: fromTop ? startBottom - height : resizeRef.current.startTop,
            });
        },
        [data.id, onResize, scale],
    );

    const handleResizeUp = useCallback(() => {
        resizeRef.current.isResizing = false;
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeUp);
    }, [handleResizeMove]);

    const handleResizeMouseDown = (event: React.MouseEvent, corner: ResizeCorner) => {
        event.stopPropagation();
        event.preventDefault();
        resizeRef.current = {
            isResizing: true,
            corner,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: data.position.x,
            startTop: data.position.y,
            startWidth: data.width,
            startHeight: data.height,
            keepRatio: (data.type === CanvasNodeType.Image && !data.metadata?.freeResize) || data.type === CanvasNodeType.Video || Boolean(definition?.keepAspectRatio?.(data)),
            ratio: (data.metadata?.naturalWidth || data.width) / (data.metadata?.naturalHeight || data.height || 1),
        };
        window.addEventListener("mousemove", handleResizeMove);
        window.addEventListener("mouseup", handleResizeUp);
    };

    useEffect(() => {
        return () => {
            window.removeEventListener("mousemove", handleResizeMove);
            window.removeEventListener("mouseup", handleResizeUp);
        };
    }, [handleResizeMove, handleResizeUp]);

    const uiScale = Math.max(scale, 0.05);
    const shellBorderColor = isGroup
        ? isGroupDropTarget || isActive ? selectionWhite : theme.node.stroke
        : hasImageContent ? imageBorderColor : isActive ? selectionWhite : isRelated ? theme.node.muted : theme.node.stroke;
    const shellOutlineWidth = isActive ? 1.8 : 1;
    const shellOutline = isGroup ? "" : `inset 0 0 0 ${shellOutlineWidth / uiScale}px ${shellBorderColor}`;
    const shellElevation = isGroupDropTarget
        ? `0 0 0 ${2 / uiScale}px ${selectionWhite}66, inset 0 0 0 999px ${selectionWhite}0d`
        : isActive
            ? `0 0 0 ${0.9 / uiScale}px ${selectionWhite}4d, 0 ${8 / uiScale}px ${24 / uiScale}px rgba(0,0,0,.12)`
            : isRelated && !isBatchChild
                ? `0 0 0 ${1 / uiScale}px ${theme.node.muted}33, 0 ${8 / uiScale}px ${24 / uiScale}px rgba(0,0,0,.10)`
                : "";

    return (
        <div
            data-node-id={data.id}
            data-canvas-no-zoom={data.type === CanvasNodeType.Text ? true : undefined}
            className={`node-element group/node absolute flex select-none flex-col transition-shadow duration-200 ${isGroup ? "z-[5]" : isSelected ? "z-50" : "z-10"}`}
            style={{
                transform: `translate(${data.position.x}px, ${data.position.y}px)`,
                width: data.width,
                height: data.height,
                transition: "box-shadow 200ms ease",
                contain: "layout style",
            }}
            onMouseEnter={() => {
                setHovered(true);
                onHoverStart(data.id);
            }}
            onMouseLeave={() => {
                setHovered(false);
                onHoverEnd(data.id);
            }}
            onMouseDownCapture={(event) => onSelectCapture?.(event, data.id)}
            onContextMenu={(event) => onContextMenu(event, data.id)}
            onWheel={(event) => {
                if (data.type !== CanvasNodeType.Text) return;
                event.stopPropagation();
                const scrollElement = isEditingContent ? textareaRef.current : textContentRef.current;
                if (!scrollElement || scrollElement.contains(event.target as Node)) return;
                event.preventDefault();
                scrollElement.scrollTop += event.deltaY / Math.max(scale, 0.05);
            }}
        >
            <div
                className="absolute left-0 top-[-24px] z-[65] flex h-5 max-w-full items-center gap-1.5 text-[12px]"
                style={{ color: theme.node.label, transform: `scale(${1 / Math.max(1, scale / 1.25)})`, transformOrigin: "left bottom" }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                {definition?.icon ? <span className="grid size-4 shrink-0 place-items-center opacity-70 [&_svg]:size-3.5">{definition.icon}</span> : null}
                {isEditingTitle ? (
                    <input
                        ref={titleInputRef}
                        value={titleDraft}
                        maxLength={64}
                        className="h-5 min-w-0 max-w-full border-0 border-b border-dashed bg-transparent px-0 text-left text-[12px] font-medium outline-none"
                        style={{ borderColor: theme.node.muted, color: theme.node.text }}
                        onChange={(event) => setTitleDraft(event.target.value)}
                        onBlur={finishTitleEditing}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") finishTitleEditing();
                            if (event.key === "Escape") {
                                setTitleDraft(data.title || "");
                                setIsEditingTitle(false);
                            }
                        }}
                    />
                ) : (
                    <button
                        type="button"
                        className="block min-w-0 max-w-full truncate border-b border-dashed border-transparent px-0 py-0 text-left text-[12px] font-medium opacity-80 transition hover:border-current hover:opacity-100"
                        style={{ color: theme.node.text }}
                        title="双击修改节点名称"
                        onDoubleClick={(event) => {
                            event.stopPropagation();
                            setIsEditingTitle(true);
                        }}
                    >
                        {data.title || "未命名节点"}
                    </button>
                )}
            </div>

            <div
                data-canvas-node-shell
                data-canvas-node-active={isActive ? "true" : undefined}
                className="relative h-full w-full overflow-visible rounded-[8px] border"
                style={{
                    background: isGroup ? `${theme.toolbar.panel}66` : hasImageContent || hasVideoContent ? "transparent" : theme.node.fill,
                    borderWidth: isGroup ? `${1 / uiScale}px` : 0,
                    borderRadius: `${8 / uiScale}px`,
                    borderColor: shellBorderColor,
                    borderStyle: isGroup ? "dashed" : "solid",
                    boxShadow: [shellOutline, shellElevation].filter(Boolean).join(", ") || undefined,
                }}
                onMouseDown={(event) => onMouseDown(event, data.id)}
                onDoubleClick={(event) => {
                    if (isBatchRoot) {
                        event.stopPropagation();
                        onToggleBatch?.(data.id);
                        return;
                    }
                    if (definition?.onDoubleClick && pluginContext) {
                        if (definition.onDoubleClick(pluginContext)) event.stopPropagation();
                        return;
                    }
                    if (data.type === CanvasNodeType.Image && hasImageContent) {
                        event.stopPropagation();
                        onViewImage?.(data);
                        return;
                    }
                    if (data.type !== CanvasNodeType.Text) return;
                    event.stopPropagation();
                    setIsEditingContent(true);
                }}
            >
                <div
                    className={`relative flex h-full w-full items-center justify-center rounded-[inherit] ${isBatchRoot ? "overflow-visible" : "overflow-hidden"}`}
                    style={
                        {
                            background: isGroup ? "transparent" : hasImageContent || hasVideoContent ? "transparent" : theme.node.fill,
                            "--batch-from-x": `${batchMotion?.x || 0}px`,
                            "--batch-from-y": `${batchMotion?.y || 0}px`,
                            "--batch-from-rotate": `${6 + (batchMotion?.index || 0) * 4}deg`,
                            animation: data.metadata?.batchRootId ? (batchClosing ? "canvas-batch-child-out 260ms cubic-bezier(.4,0,.2,1) both" : "canvas-batch-child-in 340ms cubic-bezier(.2,.85,.18,1) both") : undefined,
                            animationDelay: data.metadata?.batchRootId ? `${batchClosing ? 0 : 45 + (batchMotion?.index || 0) * 24}ms` : undefined,
                        } as React.CSSProperties
                    }
                >
                    <NodeContent
                        node={data}
                        scale={scale}
                        theme={theme}
                        isEditingContent={isEditingContent}
                        textareaRef={textareaRef}
                        textContentRef={textContentRef}
                        isBatchRoot={isBatchRoot}
                        batchCount={batchCount}
                        batchExpanded={batchExpanded}
                        batchOpening={batchOpening}
                        batchRecovering={batchRecovering}
                        renderNodeContent={renderNodeContent}
                        pluginContext={pluginContext}
                        mentionReferences={mentionReferences}
                        onContentChange={onContentChange}
                        onTextSelectionChange={onTextSelectionChange}
                        onOpenPanel={onOpenPanel}
                        onStopEditing={() => setIsEditingContent(false)}
                        onRetry={onRetry}
                        onToggleBatch={() => onToggleBatch?.(data.id)}
                        onSetBatchPrimary={() => onSetBatchPrimary?.(data)}
                        groupChildCount={groupChildCount}
                    />
                </div>

                {showImageInfo && hasImageContent ? <ImageInfoBar node={data} /> : null}
                {hovered && hasVideoContent && data.metadata?.videoProvider === "canvas-video" ? <VideoInfoBar node={data} /> : null}
                {resourceLabel && data.type !== CanvasNodeType.Text ? <ResourceLabelBadge reference={resourceLabel} /> : null}
                {data.type === CanvasNodeType.Text ? (
                    <button
                        type="button"
                        className="absolute right-1.5 top-1.5 z-40 grid size-6 place-items-center rounded-md border opacity-60 backdrop-blur transition hover:opacity-100"
                        style={{ background: `${theme.toolbar.panel}e6`, borderColor: theme.toolbar.border, color: theme.node.text }}
                        title="放大预览"
                        aria-label="放大预览文本"
                        data-canvas-no-zoom
                        onClick={(event) => {
                            event.stopPropagation();
                            onViewImage?.(data);
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                    >
                        <Maximize2 className="size-3.5" />
                    </button>
                ) : null}

                {!isGroup && !hasImageContent && !hasVideoContent && !hasAudioContent ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12" style={{ background: `linear-gradient(to top, ${theme.canvas.background}66, transparent)` }} /> : null}

                <ResizeHandle corner="top-left" onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="top-right" onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="bottom-left" onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="bottom-right" onMouseDown={handleResizeMouseDown} />
            </div>

            {!isGroup ? <ConnectionHandleDot side="left" scale={scale} visible={hovered || isSelected || isConnecting} onMouseDown={(event) => onConnectStart(event, data.id, "target")} /> : null}
            {!isGroup ? <ConnectionHandleDot side="right" scale={scale} visible={(definition?.hasSourceHandle ?? true) && data.type !== CanvasNodeType.Config && (hovered || isSelected || isConnecting)} onMouseDown={(event) => onConnectStart(event, data.id, "source")} /> : null}

            {showPanel && !isGroup && renderPanel ? (
                <div
                    data-canvas-node-panel={data.id}
                    className="absolute left-1/2 z-[70] w-[420px]"
                    style={{
                        top: "calc(100% + 8px)",
                        transform: `translateX(-50%) scale(${screenFixedScale(scale)})`,
                        transformOrigin: "top center",
                    }}
                >
                    {renderPanel(data)}
                </div>
            ) : null}
        </div>
    );
});

function NodeContent(props: NodeContentRendererProps) {
    if (props.node.type === CanvasNodeType.Config && props.renderNodeContent) return props.renderNodeContent(props.node);
    if (props.isBatchRoot) return <ImageNodeContent {...props} />;
    if (props.node.metadata?.status === "loading") return <LoadingContent node={props.node} theme={props.theme} />;
    if (props.node.metadata?.status === "error") return <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />;

    const Renderer = nodeContentRenderers[props.node.type as keyof typeof nodeContentRenderers];
    if (Renderer) return <Renderer {...props} />;

    // 插件节点:有注册渲染器则渲染,否则展示缺少插件占位
    const definition = getNodeDefinition(props.node.type);
    if (definition?.Content && props.pluginContext) {
        const PluginContent = definition.Content;
        return <PluginContent ctx={props.pluginContext} />;
    }
    return <MissingPluginContent theme={props.theme} scale={props.scale} type={props.node.type} />;
}

const nodeContentRenderers = {
    [CanvasNodeType.Text]: TextContent,
    [CanvasNodeType.Image]: ImageNodeContent,
    [CanvasNodeType.Config]: EmptyImageContent,
    [CanvasNodeType.Video]: VideoNodeContent,
    [CanvasNodeType.Audio]: AudioNodeContent,
    [CanvasNodeType.Group]: GroupNodeContent,
} satisfies Partial<Record<CanvasNodeType, (props: NodeContentRendererProps) => ReactNode>>;

function GroupNodeContent({ node, theme, groupChildCount }: NodeContentRendererProps) {
    return (
        <div className="pointer-events-none flex h-full w-full flex-col p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.text }}>
                <span className="grid size-6 place-items-center rounded-md" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
                    <Group className="size-3.5" />
                </span>
                <span>组</span>
                <span className="ml-auto rounded-md px-1.5 py-0.5 text-[10px] font-medium" style={{ background: theme.node.fill, color: theme.node.muted }}>
                    {groupChildCount} 个节点
                </span>
            </div>
            <div className="mt-2 flex-1 rounded-md border border-dashed" style={{ borderColor: theme.node.stroke, background: `${theme.node.fill}55` }} />
        </div>
    );
}

function imageContentScale(node: CanvasNodeData) {
    if (node.type !== CanvasNodeType.Image) return 1;
    return Math.max(0.25, Math.min(node.width / 340, node.height / 240));
}

function LoadingContent({ node, theme }: Pick<NodeContentRendererProps, "node" | "theme">) {
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: theme.node.activeStroke, transform: `scale(${imageContentScale(node)})` }}>
            <div className="size-7 animate-spin rounded-full border" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />
            <span className="text-[11px]">生成中</span>
        </div>
    );
}

function ErrorContent({ node, theme, onRetry }: Pick<NodeContentRendererProps, "node" | "theme" | "onRetry">) {
    return (
        <div className="flex max-w-[260px] flex-col items-center gap-2 px-4 text-center" style={{ transform: `scale(${imageContentScale(node)})` }}>
            <div className="text-xs leading-5 text-red-300">{node.metadata?.errorDetails || "生成失败"}</div>
            <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition hover:bg-white/5"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onClick={(event) => {
                    event.stopPropagation();
                    onRetry?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <RefreshCw className="size-3.5" />
                重试
            </button>
        </div>
    );
}

function MissingPluginContent({ theme, scale, type }: Pick<NodeContentRendererProps, "theme" | "scale"> & { type: string }) {
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.placeholder, transform: `scale(${screenUiScale(scale)})` }}>
            <Puzzle className="size-6 opacity-40" />
            <span className="text-[12px]">缺少插件</span>
            <span className="text-[11px] opacity-70">节点类型 “{type}” 的插件未安装或未启用</span>
        </div>
    );
}

function TextContent({ node, theme, isEditingContent, textareaRef, textContentRef, mentionReferences, onContentChange, onTextSelectionChange, onOpenPanel, onStopEditing }: NodeContentRendererProps) {
    const fontSize = node.metadata?.fontSize || 13;
    const textStyle = { fontSize: `${fontSize}px`, lineHeight: `${Math.round(fontSize * 1.55)}px`, color: theme.node.text, boxSizing: "border-box" } as React.CSSProperties;
    const [findReplaceOpen, setFindReplaceOpen] = useState(false);
    const [findText, setFindText] = useState("");
    const [replaceText, setReplaceText] = useState("");
    const content = node.metadata?.content || "";
    const replaceAll = () => {
        if (!findText) return;
        onContentChange(node.id, content.split(findText).join(replaceText));
    };

    return (
        <div className="flex h-full w-full flex-col overflow-hidden pt-6">
            {isEditingContent ? (
                <CanvasResourceMentionTextarea
                    ref={textareaRef}
                    className="thin-scrollbar m-0 block h-full w-full resize-none appearance-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent px-3 pb-7 pt-0 font-mono outline-none select-text"
                    style={textStyle}
                    value={node.metadata?.content || ""}
                    references={mentionReferences}
                    highlightLabels={false}
                    onChange={(value) => onContentChange(node.id, value)}
                    onSelect={(event) => {
                        const target = event.currentTarget;
                        onTextSelectionChange?.(node.id, target.value.slice(target.selectionStart, target.selectionEnd));
                    }}
                    onKeyUp={(event) => {
                        const target = event.currentTarget;
                        onTextSelectionChange?.(node.id, target.value.slice(target.selectionStart, target.selectionEnd));
                    }}
                    onBlur={onStopEditing}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") onStopEditing();
                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                            event.preventDefault();
                            onOpenPanel?.(node.id);
                            onStopEditing();
                        }
                        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
                            event.preventDefault();
                            setFindReplaceOpen(true);
                        }
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                />
            ) : (
                <div
                    ref={textContentRef}
                    data-canvas-no-zoom
                    className="thin-scrollbar block h-full w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-3 pb-7 pt-0 font-mono"
                    style={textStyle}
                    onWheel={(event) => event.stopPropagation()}
                >
                    {content || <span style={{ color: theme.node.placeholder }}>双击编辑文字</span>}
                </div>
            )}
            <div className="pointer-events-auto absolute bottom-1 left-3 right-3 flex items-center gap-2 text-[10px] opacity-50" style={{ color: theme.node.muted }}>
                <span>{content.length} 字 · {content ? content.split(/\r?\n/).length : 0} 行</span>
                {isEditingContent ? <button type="button" className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10" onClick={() => setFindReplaceOpen((value) => !value)}><Search className="size-3" />查找替换</button> : null}
            </div>
            {findReplaceOpen ? <div className="absolute bottom-7 left-3 right-3 z-30 flex items-center gap-1 rounded-lg border p-1.5 text-xs shadow-lg" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                <input value={findText} onChange={(event) => setFindText(event.target.value)} placeholder="查找" className="min-w-0 flex-1 rounded border bg-transparent px-2 py-1 outline-none" />
                <input value={replaceText} onChange={(event) => setReplaceText(event.target.value)} placeholder="替换为" className="min-w-0 flex-1 rounded border bg-transparent px-2 py-1 outline-none" />
                <button type="button" className="rounded px-2 py-1 hover:bg-white/10" onClick={replaceAll}>全部替换</button>
                <button type="button" className="grid size-6 place-items-center rounded hover:bg-white/10" onClick={() => setFindReplaceOpen(false)} aria-label="关闭查找替换"><X className="size-3.5" /></button>
            </div> : null}
        </div>
    );
}

function ResourceLabelBadge({ reference }: { reference: CanvasResourceReference }) {
    return (
        <span className={`pointer-events-none absolute right-2 top-2 z-30 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${reference.active ? "bg-[#2f80ff] text-white shadow-sm" : "bg-black/35 text-white/75"}`}>
            {reference.label}
        </span>
    );
}

function ImageNodeContent(props: NodeContentRendererProps) {
    if (!props.node.metadata?.content && props.isBatchRoot) {
        const content =
            props.node.metadata?.status === "loading" ? (
                <LoadingContent node={props.node} theme={props.theme} />
            ) : props.node.metadata?.status === "error" ? (
                <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />
            ) : (
                <EmptyImageContent {...props} isBatchRoot={false} />
            );
        return (
            <BatchFrame batchCount={props.batchCount} batchExpanded={props.batchExpanded} batchOpening={props.batchOpening} batchRecovering={props.batchRecovering} onToggleBatch={props.onToggleBatch}>
                {content}
            </BatchFrame>
        );
    }
    if (!props.node.metadata?.content) return <EmptyImageContent {...props} />;

    return (
        <ImageContent
            node={props.node}
            isBatchRoot={props.isBatchRoot}
            batchCount={props.batchCount}
            batchExpanded={props.batchExpanded}
            batchOpening={props.batchOpening}
            batchRecovering={props.batchRecovering}
            onToggleBatch={props.onToggleBatch}
            onSetBatchPrimary={props.onSetBatchPrimary}
        />
    );
}

function EmptyImageContent({ theme, scale, isBatchRoot, batchCount, batchExpanded, batchOpening, batchRecovering, onToggleBatch }: NodeContentRendererProps) {
    const content = (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: theme.node.placeholder, transform: `scale(${screenUiScale(scale)})` }}>
            <div className="flex size-10 items-center justify-center rounded-lg" style={{ background: theme.toolbar.activeBg }}>
                <ImageIcon className="size-5 opacity-35" />
            </div>
            <span className="text-[11px] opacity-65">空图片节点</span>
        </div>
    );
    if (isBatchRoot)
        return (
            <BatchFrame batchCount={batchCount} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} onToggleBatch={onToggleBatch}>
                {content}
            </BatchFrame>
        );
    return content;
}

function VideoNodeContent({ node, theme, scale }: NodeContentRendererProps) {
    const [loadError, setLoadError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    if (!node.metadata?.content) {
        if (node.metadata?.status === "loading" && node.metadata?.videoProvider === "canvas-video") {
            const phase = node.metadata.videoPhase === "archiving" ? "正在归档" : node.metadata.videoPhase === "queued" ? "正在排队" : "正在生成";
            return (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.text, transform: `scale(${screenUiScale(scale)})` }}>
                    <RefreshCw className="size-6 animate-spin opacity-55" />
                    <div className="text-[12px] font-medium">{phase} · {Math.max(0, node.metadata.videoProgress || 0)}%</div>
                    <div className="h-1.5 w-full max-w-48 overflow-hidden rounded-full" style={{ background: theme.node.stroke }}><div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${Math.max(3, node.metadata.videoProgress || 0)}%` }} /></div>
                </div>
            );
        }
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: theme.node.placeholder, transform: `scale(${screenUiScale(scale)})` }}>
                <div className="flex size-10 items-center justify-center rounded-lg" style={{ background: theme.toolbar.activeBg }}>
                    <Video className="size-5 opacity-35" />
                </div>
                <span className="text-[11px] opacity-65">空视频节点</span>
            </div>
        );
    }
    if (loadError) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.text, transform: `scale(${screenUiScale(scale)})` }}>
                <Video className="size-6 opacity-40" />
                <span className="text-[12px]">视频加载失败</span>
                <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[11px]" style={{ borderColor: theme.node.stroke }} onClick={(event) => { event.stopPropagation(); setLoadError(false); setReloadKey((value) => value + 1); }}><RefreshCw className="size-3.5" />重新加载</button>
            </div>
        );
    }
    return <video key={reloadKey} src={node.metadata.content} controls preload="metadata" playsInline className="h-full w-full rounded-[8px] bg-black object-contain" data-canvas-no-zoom onError={() => setLoadError(true)} />;
}

function VideoInfoBar({ node }: { node: CanvasNodeData }) {
    const meta = node.metadata;
    return (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex flex-wrap gap-x-2 gap-y-0.5 rounded-md bg-black/70 px-2 py-1.5 text-[10px] text-white backdrop-blur-sm">
            <span>{meta?.videoRouteLabel || "视频线路"}</span>
            {meta?.model ? <span>{meta.model}</span> : null}
            {meta?.vquality ? <span>{meta.vquality}</span> : null}
            {meta?.seconds ? <span>{meta.seconds}s</span> : null}
        </div>
    );
}

function AudioNodeContent({ node, theme, scale }: NodeContentRendererProps) {
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: theme.node.placeholder, transform: `scale(${screenUiScale(scale)})` }}>
                <div className="flex size-10 items-center justify-center rounded-lg" style={{ background: theme.toolbar.activeBg }}>
                    <Music2 className="size-5 opacity-35" />
                </div>
                <span className="text-[11px] opacity-65">{node.metadata?.sourceType === "tts" ? "输入文本开始配音" : "空音频节点"}</span>
            </div>
        );
    return (
        <div className="flex h-full w-full flex-col justify-center gap-2 px-3" style={{ background: theme.node.fill, color: theme.node.text }}>
            <div className="flex min-w-0 items-center gap-2 text-xs opacity-70">
                <Music2 className="size-4 shrink-0" />
                <span className="truncate">{node.metadata?.sourceType === "tts" ? (node.metadata.audioEngine ? `${node.metadata.audioEngine === "voxcpm2" ? "VoxCPM2" : "Speech"} 配音` : "生成音频") : "上传音频"}</span>
            </div>
            <audio src={node.metadata.content} controls className="w-full" data-canvas-no-zoom />
        </div>
    );
}

function ImageContent({
    node,
    isBatchRoot,
    batchCount,
    batchExpanded,
    batchOpening,
    batchRecovering,
    onToggleBatch,
    onSetBatchPrimary,
}: {
    node: CanvasNodeData;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isBatchChild = Boolean(node.metadata?.batchRootId);

    return (
        <BatchFrame batchCount={isBatchRoot ? batchCount : 0} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} onToggleBatch={onToggleBatch}>
            <div className="h-full w-full overflow-hidden rounded-[8px]">
                <img
                    src={node.metadata!.content!}
                    alt={node.title}
                    draggable={false}
                    onDragStart={(event) => event.preventDefault()}
                    className={`pointer-events-none block h-full w-full select-none ${node.metadata?.freeResize ? "object-fill" : "object-contain"}`}
                />
            </div>
            {isBatchRoot ? (
                <button
                    type="button"
                    className="absolute right-2 top-2 z-30 flex h-7 items-center justify-center gap-1 rounded-md border px-2 text-[11px] font-semibold shadow-[0_6px_18px_rgba(15,23,42,.10)] backdrop-blur-md transition hover:bg-white/5"
                    style={{ background: `${theme.toolbar.panel}d9`, borderColor: `${theme.toolbar.border}cc`, color: theme.node.text }}
                    aria-label={batchExpanded ? "图片组已展开" : "图片组已收起"}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleBatch?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <span className="leading-none text-[#2f80ff]">{batchCount}</span>
                    <ChevronRight className={`size-3.5 opacity-55 transition-transform ${batchExpanded ? "rotate-90" : ""}`} />
                </button>
            ) : null}
            {isBatchChild ? (
                <button
                    type="button"
                    className="absolute right-2 top-2 z-30 flex h-8 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium opacity-0 shadow-[0_8px_20px_rgba(68,64,60,.13)] backdrop-blur-md transition group-hover/batch:opacity-100 hover:bg-white/5"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onSetBatchPrimary?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <Star className="size-3.5 text-[#2f80ff]" />
                    设为主图
                </button>
            ) : null}
        </BatchFrame>
    );
}

function ImageInfoBar({ node }: { node: CanvasNodeData }) {
    const width = Math.round(node.metadata?.naturalWidth || node.width);
    const height = Math.round(node.metadata?.naturalHeight || node.height);
    const size = formatBytes(node.metadata?.bytes || 0);
    return (
        <div className="pointer-events-none absolute bottom-3 right-3 z-40 max-w-[calc(100%-24px)]">
            <span className="max-w-full truncate rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium leading-none text-white backdrop-blur-sm">
                {width} x {height}
                {size ? ` · ${size}` : ""}
            </span>
        </div>
    );
}

function BatchFrame({ batchCount, batchExpanded, batchOpening, batchRecovering, onToggleBatch, children }: { batchCount: number; batchExpanded: boolean; batchOpening: boolean; batchRecovering: boolean; onToggleBatch?: () => void; children: ReactNode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isBatchRoot = batchCount > 1;
    return (
        <div
            className="group/batch relative h-full w-full overflow-visible"
            onDoubleClick={
                isBatchRoot
                    ? (event) => {
                          event.stopPropagation();
                          onToggleBatch?.();
                      }
                    : undefined
            }
        >
            {isBatchRoot ? (
                <div className="pointer-events-none absolute inset-0 overflow-visible">
                    {Array.from({ length: Math.min(batchCount - 1, 5) }).map((_, index) => (
                        <div
                            key={index}
                            className="absolute rounded-[inherit] border shadow-[0_14px_34px_rgba(68,64,60,.16)] transition-all duration-300 group-hover/batch:translate-x-2"
                            style={{
                                inset: 0,
                                background: `linear-gradient(135deg, ${theme.node.panel}, ${theme.node.fill})`,
                                borderColor: theme.node.stroke,
                                opacity: batchExpanded && !batchOpening ? 0.34 : 1,
                                transform:
                                    batchOpening || batchRecovering ? `translate(${54 + index * 22}px, ${20 + index * 12}px) rotate(${8 + index * 5}deg) scale(.98)` : `translate(${34 + index * 18}px, ${14 + index * 10}px) rotate(${6 + index * 4}deg)`,
                                zIndex: -index - 1,
                            }}
                        />
                    ))}
                </div>
            ) : null}
            {children}
        </div>
    );
}
function ResizeHandle({ corner, onMouseDown }: { corner: ResizeCorner; onMouseDown: (event: React.MouseEvent, corner: ResizeCorner) => void }) {
    const positionClass = {
        "top-left": "-left-2.5 -top-2.5 cursor-nwse-resize",
        "top-right": "-right-2.5 -top-2.5 cursor-nesw-resize",
        "bottom-left": "-bottom-2.5 -left-2.5 cursor-nesw-resize",
        "bottom-right": "-bottom-2.5 -right-2.5 cursor-nwse-resize",
    }[corner];

    return <div className={`absolute z-50 size-5 ${positionClass}`} onMouseDown={(event) => onMouseDown(event, corner)} />;
}

function ConnectionHandleDot({ side, scale, visible, onMouseDown }: { side: "left" | "right"; scale: number; visible: boolean; onMouseDown: (event: React.MouseEvent) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div
            className={`absolute top-1/2 z-30 flex size-10 -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-150 ${
                side === "left" ? "-left-5" : "-right-5"
            } ${visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
            onMouseDown={onMouseDown}
        >
            <div
                className="rounded-full border transition-transform hover:scale-125"
                style={{ width: `${10 / Math.max(scale, 0.05)}px`, height: `${10 / Math.max(scale, 0.05)}px`, borderWidth: `${1 / Math.max(scale, 0.05)}px`, background: theme.node.panel, borderColor: theme.node.muted }}
            />
        </div>
    );
}
