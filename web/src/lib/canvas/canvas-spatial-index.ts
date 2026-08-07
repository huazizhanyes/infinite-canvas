export type CanvasBounds = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

export type SpatialIndexEntry<T> = {
    bounds: CanvasBounds;
    value: T;
};

export type CanvasSpatialIndex<T> = {
    query: (bounds: CanvasBounds) => T[];
};

const DEFAULT_CELL_SIZE = 640;
const MAX_CELLS_PER_ENTRY = 256;
const MAX_QUERY_CELLS = 4096;

export function createCanvasSpatialIndex<T>(entries: SpatialIndexEntry<T>[], cellSize = DEFAULT_CELL_SIZE): CanvasSpatialIndex<T> {
    const safeCellSize = Math.max(1, cellSize);
    const cells = new Map<string, number[]>();
    const overflowEntries: number[] = [];

    entries.forEach((entry, index) => {
        const minX = Math.floor(entry.bounds.left / safeCellSize);
        const maxX = Math.floor(entry.bounds.right / safeCellSize);
        const minY = Math.floor(entry.bounds.top / safeCellSize);
        const maxY = Math.floor(entry.bounds.bottom / safeCellSize);
        const cellCount = (maxX - minX + 1) * (maxY - minY + 1);
        if (cellCount > MAX_CELLS_PER_ENTRY) {
            overflowEntries.push(index);
            return;
        }

        for (let x = minX; x <= maxX; x += 1) {
            for (let y = minY; y <= maxY; y += 1) {
                const key = `${x}:${y}`;
                const bucket = cells.get(key);
                if (bucket) bucket.push(index);
                else cells.set(key, [index]);
            }
        }
    });

    return {
        query(bounds) {
            const minX = Math.floor(bounds.left / safeCellSize);
            const maxX = Math.floor(bounds.right / safeCellSize);
            const minY = Math.floor(bounds.top / safeCellSize);
            const maxY = Math.floor(bounds.bottom / safeCellSize);
            const queryCellCount = (maxX - minX + 1) * (maxY - minY + 1);
            if (queryCellCount > MAX_QUERY_CELLS) {
                return entries.filter((entry) => intersects(entry.bounds, bounds)).map((entry) => entry.value);
            }
            const matches = new Set<number>(overflowEntries);

            for (let x = minX; x <= maxX; x += 1) {
                for (let y = minY; y <= maxY; y += 1) {
                    cells.get(`${x}:${y}`)?.forEach((index) => matches.add(index));
                }
            }

            return Array.from(matches)
                .sort((a, b) => a - b)
                .filter((index) => intersects(entries[index].bounds, bounds))
                .map((index) => entries[index].value);
        },
    };
}

function intersects(a: CanvasBounds, b: CanvasBounds) {
    return a.right >= b.left && a.left <= b.right && a.bottom >= b.top && a.top <= b.bottom;
}
