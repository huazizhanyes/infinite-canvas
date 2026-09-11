import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "@/types/canvas";

export type CanvasArrangeMode = "smart" | "horizontal" | "vertical" | "grid";

export const CANVAS_ARRANGE_GAP = 48;

type NodeBounds = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

type CanvasLayoutUnit = {
    id: string;
    nodes: CanvasNodeData[];
    memberIds: Set<string>;
    bounds: NodeBounds;
    level: number;
};

type PlacedUnit = CanvasLayoutUnit & {
    target: Position;
};

export function arrangeCanvasSelection(allNodes: CanvasNodeData[], connections: CanvasConnection[], selectedNodeIds: ReadonlySet<string>, options: { mode: CanvasArrangeMode; gap?: number }) {
    if (selectedNodeIds.size < 2) return allNodes;

    const nodeById = new Map(allNodes.map((node) => [node.id, node]));
    const levels = buildGraphLevels(allNodes, connections);
    const units = buildLayoutUnits(allNodes, selectedNodeIds, nodeById, levels);
    if (units.length < 2) return allNodes;

    const selectedMemberIds = new Set(units.flatMap((unit) => [...unit.memberIds]));
    const hasSelectedConnections = connections.some((connection) => selectedMemberIds.has(connection.fromNodeId) && selectedMemberIds.has(connection.toNodeId));
    const gap = options.gap ?? CANVAS_ARRANGE_GAP;
    const placed = placeUnits(units, options.mode, gap, hasSelectedConnections);
    const before = boundsForUnits(units);
    const after = boundsForPlacedUnits(placed);
    const dx = (before.left + before.right) / 2 - (after.left + after.right) / 2;
    const dy = (before.top + before.bottom) / 2 - (after.top + after.bottom) / 2;
    const positions = new Map<string, Position>();

    placed.forEach((unit) => {
        unit.nodes.forEach((node) => {
            positions.set(node.id, {
                x: node.position.x + unit.target.x - unit.bounds.left + dx,
                y: node.position.y + unit.target.y - unit.bounds.top + dy,
            });
        });
    });

    return allNodes.map((node) => {
        const position = positions.get(node.id);
        return position ? { ...node, position } : node;
    });
}

function buildLayoutUnits(allNodes: CanvasNodeData[], selectedNodeIds: ReadonlySet<string>, nodeById: ReadonlyMap<string, CanvasNodeData>, levels: ReadonlyMap<string, number>) {
    const selectedNodes = allNodes.filter((node) => selectedNodeIds.has(node.id));
    const claimedIds = new Set<string>();
    const units: CanvasLayoutUnit[] = [];

    // A selected group or batch root moves as one unit so its children keep
    // their relative positions during arrangement.
    selectedNodes.forEach((node) => {
        if (claimedIds.has(node.id) || (node.type !== CanvasNodeType.Group && !node.metadata?.isBatchRoot)) return;
        const memberIds = new Set<string>([node.id]);
        if (node.type === CanvasNodeType.Group) {
            allNodes.forEach((candidate) => {
                if (candidate.metadata?.groupId === node.id) memberIds.add(candidate.id);
            });
        }
        node.metadata?.batchChildIds?.forEach((childId) => {
            if (nodeById.has(childId)) memberIds.add(childId);
        });
        if ([...memberIds].some((id) => claimedIds.has(id))) return;
        memberIds.forEach((id) => claimedIds.add(id));
        units.push(createLayoutUnit(node.id, [...memberIds].flatMap((id) => nodeById.get(id) || []), levels));
    });

    selectedNodes.forEach((node) => {
        if (claimedIds.has(node.id)) return;
        claimedIds.add(node.id);
        units.push(createLayoutUnit(node.id, [node], levels));
    });

    return units;
}

function createLayoutUnit(id: string, nodes: CanvasNodeData[], levels: ReadonlyMap<string, number>): CanvasLayoutUnit {
    const memberIds = new Set(nodes.map((node) => node.id));
    return {
        id,
        nodes,
        memberIds,
        bounds: nodeBounds(nodes),
        level: Math.min(...nodes.map((node) => levels.get(node.id) ?? 0)),
    };
}

function placeUnits(units: CanvasLayoutUnit[], mode: CanvasArrangeMode, gap: number, hasSelectedConnections: boolean): PlacedUnit[] {
    const readingOrder = [...units].sort(compareReadingOrder);
    if (mode === "horizontal") return placeRow(sortByFlow(readingOrder, hasSelectedConnections), gap);
    if (mode === "vertical") return placeColumn(sortByFlow(readingOrder, hasSelectedConnections), gap);
    if (mode === "grid" || !hasSelectedConnections) return placeGrid(readingOrder, gap);
    return placeLayers(sortByFlow(readingOrder, true), gap);
}

function placeRow(units: CanvasLayoutUnit[], gap: number) {
    const maxHeight = Math.max(...units.map((unit) => unitHeight(unit)));
    let x = 0;
    return units.map((unit) => {
        const height = unitHeight(unit);
        const placed = { ...unit, target: { x, y: (maxHeight - height) / 2 } };
        x += unitWidth(unit) + gap;
        return placed;
    });
}

function placeColumn(units: CanvasLayoutUnit[], gap: number) {
    const maxWidth = Math.max(...units.map(unitWidth));
    let y = 0;
    return units.map((unit) => {
        const width = unitWidth(unit);
        const placed = { ...unit, target: { x: (maxWidth - width) / 2, y } };
        y += unitHeight(unit) + gap;
        return placed;
    });
}

function placeGrid(units: CanvasLayoutUnit[], gap: number) {
    const columns = Math.ceil(Math.sqrt(units.length));
    const rows = Math.ceil(units.length / columns);
    const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(...units.filter((_, index) => index % columns === column).map(unitWidth), 0));
    const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(...units.filter((_, index) => Math.floor(index / columns) === row).map(unitHeight), 0));
    const columnOffsets = offsets(columnWidths, gap);
    const rowOffsets = offsets(rowHeights, gap);

    return units.map((unit, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        return {
            ...unit,
            target: {
                x: columnOffsets[column] + (columnWidths[column] - unitWidth(unit)) / 2,
                y: rowOffsets[row] + (rowHeights[row] - unitHeight(unit)) / 2,
            },
        };
    });
}

function placeLayers(units: CanvasLayoutUnit[], gap: number) {
    const byLevel = new Map<number, CanvasLayoutUnit[]>();
    units.forEach((unit) => byLevel.set(unit.level, [...(byLevel.get(unit.level) || []), unit]));
    const columns = [...byLevel.entries()].sort(([left], [right]) => left - right).map(([, column]) => column.sort(compareReadingOrder));
    const columnWidths = columns.map((column) => Math.max(...column.map(unitWidth), 0));
    const columnHeights = columns.map((column) => column.reduce((total, unit) => total + unitHeight(unit), 0) + gap * Math.max(column.length - 1, 0));
    const maxHeight = Math.max(...columnHeights, 0);
    const columnOffsets = offsets(columnWidths, gap);

    return columns.flatMap((column, columnIndex) => {
        const columnHeight = columnHeights[columnIndex];
        let y = (maxHeight - columnHeight) / 2;
        return column.map((unit) => {
            const placed = { ...unit, target: { x: columnOffsets[columnIndex], y } };
            y += unitHeight(unit) + gap;
            return placed;
        });
    });
}

function sortByFlow(units: CanvasLayoutUnit[], useFlowOrder: boolean) {
    return useFlowOrder ? [...units].sort((left, right) => left.level - right.level || compareReadingOrder(left, right)) : units;
}

function compareReadingOrder(left: CanvasLayoutUnit, right: CanvasLayoutUnit) {
    return left.bounds.top - right.bounds.top || left.bounds.left - right.bounds.left || left.id.localeCompare(right.id);
}

function offsets(sizes: number[], gap: number) {
    const result: number[] = [];
    let current = 0;
    sizes.forEach((size) => {
        result.push(current);
        current += size + gap;
    });
    return result;
}

function unitWidth(unit: CanvasLayoutUnit) {
    return unit.bounds.right - unit.bounds.left;
}

function unitHeight(unit: CanvasLayoutUnit) {
    return unit.bounds.bottom - unit.bounds.top;
}

function boundsForUnits(units: CanvasLayoutUnit[]) {
    return units.reduce(
        (bounds, unit) => ({
            left: Math.min(bounds.left, unit.bounds.left),
            top: Math.min(bounds.top, unit.bounds.top),
            right: Math.max(bounds.right, unit.bounds.right),
            bottom: Math.max(bounds.bottom, unit.bounds.bottom),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
}

function boundsForPlacedUnits(units: PlacedUnit[]) {
    return units.reduce(
        (bounds, unit) => ({
            left: Math.min(bounds.left, unit.target.x),
            top: Math.min(bounds.top, unit.target.y),
            right: Math.max(bounds.right, unit.target.x + unitWidth(unit)),
            bottom: Math.max(bounds.bottom, unit.target.y + unitHeight(unit)),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
}

function buildGraphLevels(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const incoming = new Map(nodes.map((node) => [node.id, 0]));
    const outgoing = new Map<string, string[]>();

    connections.forEach((connection) => {
        if (!nodeIds.has(connection.fromNodeId) || !nodeIds.has(connection.toNodeId)) return;
        incoming.set(connection.toNodeId, (incoming.get(connection.toNodeId) || 0) + 1);
        outgoing.set(connection.fromNodeId, [...(outgoing.get(connection.fromNodeId) || []), connection.toNodeId]);
    });

    const levels = new Map(nodes.map((node) => [node.id, 0]));
    const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
    for (let index = 0; index < queue.length; index += 1) {
        const nodeId = queue[index];
        (outgoing.get(nodeId) || []).forEach((nextId) => {
            levels.set(nextId, Math.max(levels.get(nextId) || 0, (levels.get(nodeId) || 0) + 1));
            incoming.set(nextId, (incoming.get(nextId) || 0) - 1);
            if (incoming.get(nextId) === 0) queue.push(nextId);
        });
    }

    return levels;
}

function nodeBounds(nodes: CanvasNodeData[]): NodeBounds {
    return nodes.reduce(
        (bounds, node) => ({
            left: Math.min(bounds.left, node.position.x),
            top: Math.min(bounds.top, node.position.y),
            right: Math.max(bounds.right, node.position.x + node.width),
            bottom: Math.max(bounds.bottom, node.position.y + node.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
}