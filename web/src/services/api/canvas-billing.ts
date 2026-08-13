import axios from "axios";
import type { UserAssetConnection } from "./user-assets";

export type CanvasBillingQuote = {
    quoteToken: string;
    currency: "CNY";
    maximumAmountMicros: string;
    walletAmountMicros: string;
    walletBalanceMicros: string;
    walletReservedMicros: string;
    pricingVersion: number;
    expiresAt: string;
    canSubmit: boolean;
    code: string;
    canvasMembershipTier: "free" | "member" | "super";
    benefitAllocation: Array<{ type: string; units: string }>;
    benefitSummary?: {
        image?: {
            monthlyLimit: number;
            monthlyUsed: number;
            monthlyRemaining: number;
            purchasedBalance: number;
            cycleMonth: string;
        };
    };
    breakdown: Record<string, unknown>;
};

export type CanvasWalletPlan = { id: string; name: string; amount: string | number; pay_amount_fen?: string; wallet_amount_micros?: string; description?: string };

const base = (connection: UserAssetConnection) => `${connection.canvasBaseUrl.replace(/\/+$/, "")}/v1`;
const headers = (connection: UserAssetConnection) => ({ Authorization: `Bearer ${connection.token}` });

export const canvasBillingApi = {
    async quote(connection: UserAssetConnection, payload: Record<string, unknown>, signal?: AbortSignal) {
        const { data } = await axios.post<CanvasBillingQuote>(`${base(connection)}/billing/quote`, payload, { headers: headers(connection), signal });
        return data;
    },
    async summary(connection: UserAssetConnection) {
        const { data } = await axios.get(`${base(connection)}/billing/summary`, { headers: headers(connection) });
        return data;
    },
    async plans(connection: UserAssetConnection) {
        const { data } = await axios.get<{ items?: CanvasWalletPlan[] }>(`${base(connection)}/wallet/plans`, { headers: headers(connection) });
        return data.items || [];
    },
    async createOrder(connection: UserAssetConnection, planId: string) {
        const { data } = await axios.post<Record<string, unknown>>(`${base(connection)}/wallet/orders`, { planId }, { headers: headers(connection) });
        return data;
    },
    async orderStatus(connection: UserAssetConnection, orderNo: string) {
        const { data } = await axios.get<Record<string, unknown>>(`${base(connection)}/wallet/orders/${encodeURIComponent(orderNo)}`, { headers: headers(connection) });
        return data;
    },
};

export function formatCnyMicros(value: string | number, prefix = "最高 ") {
    const micros = Math.max(0, Number(value || 0));
    if (micros > 0 && micros < 100) return `${prefix}<¥0.0001`;
    return `${prefix}¥${(micros / 1_000_000).toFixed(4)}`;
}

export function canvasQuoteLabel(quote: CanvasBillingQuote) {
    const benefits = quote.benefitAllocation || [];
    if (quote.maximumAmountMicros === "0" && benefits.some((item) => item.type === "super_text_free")) return "超级会员免费";
    if (quote.maximumAmountMicros === "0" && benefits.length) return "权益额度抵扣";
    return formatCnyMicros(quote.maximumAmountMicros);
}

export function canvasCompactQuoteLabel(quote: CanvasBillingQuote) {
    const units = Math.max(0, Number(quote.breakdown?.requestUnits || 0));
    const benefits = quote.benefitAllocation || [];
    if (quote.maximumAmountMicros === "0" && benefits.some((item) => item.type === "super_text_free")) return "免费";
    if (quote.maximumAmountMicros === "0" && benefits.length) return "本次免费";
    return formatCnyMicros(quote.maximumAmountMicros, "");
}
