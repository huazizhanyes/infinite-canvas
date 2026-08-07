import React, { useEffect, useRef, useState } from "react";

import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ViewportTransform } from "@/types/canvas";

type InfiniteCanvasProps = {
    containerRef: React.RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
    backgroundMode?: CanvasBackgroundMode;
    onViewportChange: (viewport: ViewportTransform) => void;
    onViewportInteractionStart?: () => void;
    onCanvasMouseDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onCanvasDeselect?: () => void;
    onCanvasDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
    onContextMenu?: (event: React.MouseEvent) => void;
    onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
    children: React.ReactNode;
};

export function calculateWheelViewport(viewport: ViewportTransform, pointerX: number, pointerY: number, deltaY: number, deltaMode: number, pageHeight: number) {
    const deltaUnit = deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1;
    const normalizedDelta = Math.max(-240, Math.min(240, deltaY * deltaUnit));
    if (!normalizedDelta) return viewport;

    const nextScale = Math.min(Math.max(viewport.k * Math.exp(-normalizedDelta * 0.001), 0.05), 5);
    if (nextScale === viewport.k) return viewport;
    const worldX = (pointerX - viewport.x) / viewport.k;
    const worldY = (pointerY - viewport.y) / viewport.k;
    return {
        x: pointerX - worldX * nextScale,
        y: pointerY - worldY * nextScale,
        k: nextScale,
    };
}

export function InfiniteCanvas({ containerRef, viewport, backgroundMode = "lines", onViewportChange, onViewportInteractionStart, onCanvasMouseDown, onCanvasDeselect, onCanvasDoubleClick, onContextMenu, onDrop, children }: InfiniteCanvasProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const panState = useRef({
        isPanning: false,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0,
        hasMoved: false,
    });
    const viewportRef = useRef(viewport);
    const sceneRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const panFrameRef = useRef<number | null>(null);
    const wheelFrameRef = useRef<number | null>(null);
    const nextViewportRef = useRef<ViewportTransform | null>(null);
    const nextWheelViewportRef = useRef<ViewportTransform | null>(null);
    const wheelInteractionActiveRef = useRef(false);
    const wheelInteractionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const finishWheelInteractionRef = useRef<() => void>(() => undefined);
    const onViewportChangeRef = useRef(onViewportChange);
    const onViewportInteractionStartRef = useRef(onViewportInteractionStart);
    const onCanvasDeselectRef = useRef(onCanvasDeselect);
    const [isSpacePressed, setIsSpacePressed] = useState(false);

    const syncInteractionAttribute = () => {
        containerRef.current?.toggleAttribute("data-canvas-interacting", panState.current.isPanning || wheelInteractionActiveRef.current);
    };

    const applyPendingWheelPreview = () => {
        if (wheelFrameRef.current !== null) {
            cancelAnimationFrame(wheelFrameRef.current);
            wheelFrameRef.current = null;
        }
        const nextViewport = nextWheelViewportRef.current;
        nextWheelViewportRef.current = null;
        if (!nextViewport) return;
        viewportRef.current = nextViewport;
        applyViewportPreview(sceneRef.current, gridRef.current, nextViewport);
    };

    const finishWheelInteraction = () => {
        if (wheelInteractionTimerRef.current) clearTimeout(wheelInteractionTimerRef.current);
        wheelInteractionTimerRef.current = null;
        applyPendingWheelPreview();
        if (!wheelInteractionActiveRef.current) return;
        wheelInteractionActiveRef.current = false;
        onViewportChangeRef.current(viewportRef.current);
        syncInteractionAttribute();
    };
    finishWheelInteractionRef.current = finishWheelInteraction;

    useEffect(() => {
        if (!wheelInteractionActiveRef.current && !panState.current.isPanning) viewportRef.current = viewport;
    }, [viewport]);

    useEffect(() => {
        onViewportChangeRef.current = onViewportChange;
        onViewportInteractionStartRef.current = onViewportInteractionStart;
        onCanvasDeselectRef.current = onCanvasDeselect;
    }, [onCanvasDeselect, onViewportChange, onViewportInteractionStart]);

    useEffect(
        () => () => {
            if (panFrameRef.current !== null) cancelAnimationFrame(panFrameRef.current);
            if (wheelFrameRef.current !== null) cancelAnimationFrame(wheelFrameRef.current);
            if (wheelInteractionTimerRef.current) clearTimeout(wheelInteractionTimerRef.current);
            containerRef.current?.removeAttribute("data-canvas-interacting");
            document.body.style.cursor = "";
        },
        [],
    );

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.code !== "Space") return;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
            setIsSpacePressed(true);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === "Space") setIsSpacePressed(false);
        };
        const handleBlur = () => {
            setIsSpacePressed(false);
            finishWheelInteractionRef.current();
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleBlur);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", handleBlur);
        };
    }, []);

    const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown")) return;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const currentViewport = nextWheelViewportRef.current || viewportRef.current;
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const nextViewport = calculateWheelViewport(currentViewport, mouseX, mouseY, event.deltaY, event.deltaMode, rect.height);
        if (nextViewport === currentViewport) return;
        nextWheelViewportRef.current = nextViewport;
        if (!wheelInteractionActiveRef.current) {
            wheelInteractionActiveRef.current = true;
            onViewportInteractionStartRef.current?.();
            syncInteractionAttribute();
        }
        if (wheelInteractionTimerRef.current) clearTimeout(wheelInteractionTimerRef.current);
        wheelInteractionTimerRef.current = setTimeout(() => finishWheelInteractionRef.current(), 160);
        if (wheelFrameRef.current !== null) return;
        wheelFrameRef.current = requestAnimationFrame(() => {
            wheelFrameRef.current = null;
            const nextViewport = nextWheelViewportRef.current;
            nextWheelViewportRef.current = null;
            if (!nextViewport) return;
            viewportRef.current = nextViewport;
            applyViewportPreview(sceneRef.current, gridRef.current, nextViewport);
        });
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom]")) return;
        if (target?.closest("[data-connection-create-menu]")) return;
        const isBackgroundClick = !target?.closest("[data-node-id],[data-connection-id]");

        if (event.button === 0 && (event.ctrlKey || event.metaKey) && isBackgroundClick) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onCanvasMouseDown?.(event);
            return;
        }

        if (event.button === 1 || (event.button === 0 && (isSpacePressed || isBackgroundClick))) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            panState.current = {
                isPanning: true,
                startX: event.clientX,
                startY: event.clientY,
                initialX: viewportRef.current.x,
                initialY: viewportRef.current.y,
                hasMoved: false,
            };
            onViewportInteractionStartRef.current?.();
            syncInteractionAttribute();
            document.body.style.cursor = "grabbing";
            return;
        }

    };

    const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],[data-node-id],[data-connection-id]")) return;
        onCanvasDoubleClick?.(event);
    };

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            if (!panState.current.isPanning) return;

            const dx = event.clientX - panState.current.startX;
            const dy = event.clientY - panState.current.startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                panState.current.hasMoved = true;
            }

            nextViewportRef.current = {
                x: panState.current.initialX + dx,
                y: panState.current.initialY + dy,
                k: viewportRef.current.k,
            };
            if (panFrameRef.current !== null) return;
            panFrameRef.current = requestAnimationFrame(() => {
                panFrameRef.current = null;
                if (nextViewportRef.current) applyViewportPreview(sceneRef.current, gridRef.current, nextViewportRef.current);
            });
        };

        const handlePointerUp = () => {
            if (!panState.current.isPanning) return;

            if (!panState.current.hasMoved) {
                onCanvasDeselectRef.current?.();
            }
            panState.current.isPanning = false;
            document.body.style.cursor = "";
            if (panFrameRef.current !== null) {
                cancelAnimationFrame(panFrameRef.current);
                panFrameRef.current = null;
            }
            if (nextViewportRef.current) {
                applyViewportPreview(sceneRef.current, gridRef.current, nextViewportRef.current);
                viewportRef.current = nextViewportRef.current;
                onViewportChangeRef.current(nextViewportRef.current);
                nextViewportRef.current = null;
            }
            syncInteractionAttribute();
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
        window.addEventListener("blur", handlePointerUp);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
            window.removeEventListener("blur", handlePointerUp);
        };
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // 阻止画布滚动导致页面滚动;但浮层(创建菜单/弹窗等)内允许原生滚动
        const preventWheelScroll = (event: WheelEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown")) return;
            event.preventDefault();
        };
        container.addEventListener("wheel", preventWheelScroll, { passive: false });
        return () => container.removeEventListener("wheel", preventWheelScroll);
    }, [containerRef]);

    return (
        <div
            ref={containerRef}
            data-infinite-canvas
            className="relative h-full w-full touch-none cursor-grab select-none overflow-hidden"
            style={{ background: theme.canvas.background }}
            onPointerDown={handlePointerDown}
            onDoubleClick={handleDoubleClick}
            onWheel={handleWheel}
            onContextMenu={onContextMenu}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
        >
            <CanvasGrid gridRef={gridRef} viewport={viewport} mode={backgroundMode} />
            <div
                ref={sceneRef}
                className="absolute origin-top-left"
                style={{
                    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`,
                }}
            >
                {children}
            </div>
        </div>
    );
}

function CanvasGrid({ gridRef, viewport, mode }: { gridRef: React.RefObject<HTMLDivElement | null>; viewport: ViewportTransform; mode: CanvasBackgroundMode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (mode === "blank") return null;

    const gridSize = 48 * viewport.k;
    const x = viewport.x % gridSize;
    const y = viewport.y % gridSize;
    const dotSize = viewport.k < 0.12 ? 0.8 : 1.15;
    const backgroundImage =
        mode === "dots" ? `radial-gradient(circle, ${theme.canvas.dot} ${dotSize}px, transparent ${dotSize + 0.2}px)` : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`;

    return (
        <div
            ref={gridRef}
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
                backgroundImage,
                backgroundSize: `${gridSize}px ${gridSize}px`,
                backgroundPosition: `${x}px ${y}px`,
            }}
        />
    );
}

function applyViewportPreview(scene: HTMLDivElement | null, grid: HTMLDivElement | null, viewport: ViewportTransform) {
    if (scene) scene.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`;
    if (!grid) return;
    const gridSize = 48 * viewport.k;
    grid.style.backgroundSize = `${gridSize}px ${gridSize}px`;
    grid.style.backgroundPosition = `${viewport.x % gridSize}px ${viewport.y % gridSize}px`;
}
