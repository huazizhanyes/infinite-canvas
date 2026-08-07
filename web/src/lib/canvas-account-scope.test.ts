import { afterEach, describe, expect, it } from "vitest";
import { accountScopedKey, clearCanvasAccountScope, getCanvasSessionEpoch, setCanvasAccountScope } from "./canvas-account-scope";

describe("canvas account scope", () => {
    afterEach(() => clearCanvasAccountScope());

    it("keeps storage keys and epochs isolated between accounts", () => {
        const first = setCanvasAccountScope("101");
        const firstKey = accountScopedKey("canvas_outbox");
        const second = setCanvasAccountScope("202");
        const secondKey = accountScopedKey("canvas_outbox");
        expect(first?.userId).toBe("101");
        expect(second?.userId).toBe("202");
        expect(firstKey).not.toBe(secondKey);
        expect(second!.sessionEpoch).toBeGreaterThan(first!.sessionEpoch);
        expect(getCanvasSessionEpoch()).toBe(second!.sessionEpoch);
    });

    it("does not treat a logout as another user's scope", () => {
        setCanvasAccountScope("101");
        clearCanvasAccountScope();
        expect(accountScopedKey("canvas_store")).toContain(":u:guest");
    });
});
