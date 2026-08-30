import { describe, expect, it } from "vitest";

import { calculateWheelViewport, shouldZoomCanvasForWheel } from "./infinite-canvas";

describe("calculateWheelViewport", () => {
    it("keeps the world point under the pointer fixed", () => {
        const viewport = { x: 120, y: -40, k: 1.5 };
        const pointer = { x: 460, y: 280 };
        const next = calculateWheelViewport(viewport, pointer.x, pointer.y, -120, 0, 800);

        expect((pointer.x - next.x) / next.k).toBeCloseTo((pointer.x - viewport.x) / viewport.k);
        expect((pointer.y - next.y) / next.k).toBeCloseTo((pointer.y - viewport.y) / viewport.k);
        expect(next.k).toBeGreaterThan(viewport.k);
    });

    it("accumulates successive deltas and normalizes line-mode wheels", () => {
        const initial = { x: 0, y: 0, k: 1 };
        const first = calculateWheelViewport(initial, 300, 200, 3, 1, 800);
        const second = calculateWheelViewport(first, 300, 200, 3, 1, 800);

        expect(second.k).toBeLessThan(first.k);
        expect(second.k).toBeCloseTo(Math.exp(-0.096));
    });

    it("clamps zoom to the supported range", () => {
        expect(calculateWheelViewport({ x: 0, y: 0, k: 0.05 }, 0, 0, 120, 0, 800).k).toBe(0.05);
        expect(calculateWheelViewport({ x: 0, y: 0, k: 5 }, 0, 0, -120, 0, 800).k).toBe(5);
    });
});

describe("shouldZoomCanvasForWheel", () => {
    it("zooms for an ordinary wheel over the canvas", () => {
        expect(shouldZoomCanvasForWheel(false, false, false)).toBe(true);
    });

    it("keeps ordinary scrolling inside canvas controls", () => {
        expect(shouldZoomCanvasForWheel(true, false, false)).toBe(false);
    });

    it("routes Ctrl or Command wheel gestures to canvas zoom even over controls", () => {
        expect(shouldZoomCanvasForWheel(true, true, false)).toBe(true);
        expect(shouldZoomCanvasForWheel(true, false, true)).toBe(true);
    });
});
