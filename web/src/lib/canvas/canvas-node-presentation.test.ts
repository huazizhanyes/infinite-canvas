import { describe, expect, it } from "vitest";

import { canvasNodeStackClass } from "./canvas-node-presentation";

describe("canvasNodeStackClass", () => {
    it("keeps ordinary node stacking stable while elevating only panels and live connection targets", () => {
        expect(canvasNodeStackClass(false, false, false)).toBe("z-10");
        expect(canvasNodeStackClass(false, false, true)).toBe("z-50");
        expect(canvasNodeStackClass(false, true, true)).toBe("z-[60]");
        expect(canvasNodeStackClass(true, false, true)).toBe("z-[5]");
    });
});
