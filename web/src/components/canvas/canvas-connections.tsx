import { memo, useCallback, useMemo, type MouseEvent as ReactMouseEvent } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasBounds } from "@/lib/canvas/canvas-spatial-index";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "@/types/canvas";

type ConnectionPathProps = {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    active: boolean;
    onSelect: (connectionId: string) => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>, connectionId: string) => void;
};

export function getConnectionGeometry(from: CanvasNodeData, to: CanvasNodeData) {
    const startX = from.position.x + from.width;
    const startY = from.position.y + from.height / 2;
    const endX = to.position.x;
    const endY = to.position.y + to.height / 2;
    const curvature = Math.max(Math.abs(endX - startX) * 0.5, 50);
    return { startX, startY, endX, endY, curvature };
}

export function getConnectionBounds(from: CanvasNodeData, to: CanvasNodeData): CanvasBounds {
    const { startX, startY, endX, endY, curvature } = getConnectionGeometry(from, to);
    return {
        left: Math.min(startX, startX + curvature, endX - curvature, endX),
        top: Math.min(startY, endY),
        right: Math.max(startX, startX + curvature, endX - curvature, endX),
        bottom: Math.max(startY, endY),
    };
}

export const ConnectionPath = memo(function ConnectionPath({
    connection,
    from,
    to,
    active,
    onSelect,
    onContextMenu,
}: ConnectionPathProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const pathD = useMemo(() => {
        const { startX, startY, endX, endY, curvature } = getConnectionGeometry(from, to);
        return `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;
    }, [from.height, from.position.x, from.position.y, from.width, to.height, to.position.x, to.position.y]);
    const handleSelect = useCallback(
        (event: ReactMouseEvent<SVGPathElement>) => {
            event.stopPropagation();
            onSelect(connection.id);
        },
        [connection.id, onSelect],
    );
    const handleContextMenu = useCallback(
        (event: ReactMouseEvent<SVGPathElement>) => {
            event.preventDefault();
            event.stopPropagation();
            onContextMenu?.(event, connection.id);
        },
        [connection.id, onContextMenu],
    );

    return (
        <g>
            <path
                data-connection-id={connection.id}
                d={pathD}
                stroke="transparent"
                strokeWidth="20"
                fill="none"
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onClick={handleSelect}
                onContextMenu={handleContextMenu}
            />
            <path
                d={pathD}
                stroke={active ? theme.node.activeStroke : theme.node.muted}
                strokeWidth={active ? 3 : 2}
                strokeOpacity={active ? 1 : 0.82}
                fill="none"
                style={{ filter: active ? `drop-shadow(0 0 8px ${theme.node.activeStroke}66)` : undefined, pointerEvents: "none" }}
            />
        </g>
    );
}, areConnectionPathPropsEqual);

function areConnectionPathPropsEqual(previous: ConnectionPathProps, next: ConnectionPathProps) {
    return previous.connection.id === next.connection.id
        && previous.active === next.active
        && previous.onSelect === next.onSelect
        && previous.onContextMenu === next.onContextMenu
        && previous.from.position.x === next.from.position.x
        && previous.from.position.y === next.from.position.y
        && previous.from.width === next.from.width
        && previous.from.height === next.from.height
        && previous.to.position.x === next.to.position.x
        && previous.to.position.y === next.to.position.y
        && previous.to.height === next.to.height;
}

export function ActiveConnectionPath({ node, handle, mouseWorld, target }: { node?: CanvasNodeData; handle: ConnectionHandle; mouseWorld: Position; target?: CanvasNodeData }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!node) return null;

    const startX = handle.handleType === "source" ? node.position.x + node.width : mouseWorld.x;
    const startY = handle.handleType === "source" ? node.position.y + node.height / 2 : mouseWorld.y;
    const endX = handle.handleType === "source" ? mouseWorld.x : node.position.x;
    const endY = handle.handleType === "source" ? mouseWorld.y : node.position.y + node.height / 2;
    const snappedStartX = handle.handleType === "target" && target ? target.position.x + target.width : startX;
    const snappedStartY = handle.handleType === "target" && target ? connectionTouchY(target, mouseWorld.y) : startY;
    const snappedEndX = handle.handleType === "source" && target ? target.position.x : endX;
    const snappedEndY = handle.handleType === "source" && target ? connectionTouchY(target, mouseWorld.y) : endY;
    const distance = Math.abs(snappedEndX - snappedStartX);
    const pathD = `M ${snappedStartX} ${snappedStartY} C ${snappedStartX + distance * 0.5} ${snappedStartY}, ${snappedEndX - distance * 0.5} ${snappedEndY}, ${snappedEndX} ${snappedEndY}`;

    return (
        <g style={{ pointerEvents: "none" }}>
            <path d={pathD} stroke={theme.node.activeStroke} strokeWidth="11" strokeOpacity="0.16" fill="none" strokeLinecap="round" style={{ filter: `blur(5px) drop-shadow(0 0 8px ${theme.node.activeStroke})` }} />
            <path d={pathD} stroke={theme.node.activeStroke} strokeWidth="3.2" strokeOpacity="0.95" fill="none" strokeLinecap="round" />
            <path d={pathD} stroke="#ffffff" strokeWidth="1.1" strokeOpacity="0.72" fill="none" strokeLinecap="round" />
        </g>
    );
}

function connectionTouchY(node: CanvasNodeData, pointerY: number) {
    const inset = Math.min(20, node.height / 4);
    return Math.max(node.position.y + inset, Math.min(node.position.y + node.height - inset, pointerY));
}
