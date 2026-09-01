import { describe, expect, it } from "vitest";
import { canvasCompactQuoteLabel, canvasQuoteLabel, type CanvasBillingQuote } from "./canvas-billing";

const promotionQuote: CanvasBillingQuote = {
    quoteToken: "quote-token",
    currency: "CNY",
    maximumAmountMicros: "0",
    walletAmountMicros: "0",
    walletBalanceMicros: "1000000",
    walletReservedMicros: "0",
    pricingVersion: 1,
    expiresAt: "2026-09-01T00:00:00.000Z",
    canSubmit: true,
    code: "OK",
    canvasMembershipTier: "free",
    benefitAllocation: [],
    breakdown: {
        promotionFree: true,
        promotionLabel: "新模型体验周",
    },
};

describe("canvas billing labels", () => {
    it("shows the configured promotion in the full quote label", () => {
        expect(canvasQuoteLabel(promotionQuote)).toBe("新模型体验周");
    });

    it("uses a stable compact label for a free promotion", () => {
        expect(canvasCompactQuoteLabel(promotionQuote)).toBe("限时免费");
    });
});
