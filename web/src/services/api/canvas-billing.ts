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
    breakdown: Record<string, unknown> & { tierCode?: "NORMAL" | "SILVER" | "GOLD" | "DIAMOND"; normalUnitPriceMicros?: string; tierUnitPriceMicros?: string; requestedSeconds?: string; originalAmountMicros?: string; savingsMicros?: string; payableAmountMicros?: string };
};

export type CanvasWalletPlan = { id: string; name: string; amount: string | number; pay_amount_fen?: string; wallet_amount_micros?: string; description?: string };

export type AiRechargePackage = {
    id: string;
    name: string;
    description?: string | null;
    recommended?: boolean;
    tier_code?: "silver" | "gold" | "diamond" | null;
    display_name?: string | null;
    badge_label?: string | null;
    theme_key?: string | null;
    comparison_order?: number | null;
    version: {
        id: string;
        version_no: number;
        pay_amount_fen: string;
        wallet_amount_micros: string;
        image_quota: string;
        audio_char_quota: string;
        benefits_snapshot?: Record<string, unknown> | null;
    };
};

export type AiMemberCenter = {
    packages: AiRechargePackage[];
    tier_rules: Array<{ id: string; name: string; threshold_pay_fen: string; text_free_enabled: boolean; video_discount_bps: number }>;
    settings: AiCommerceSettings;
    current_profile: (AiCommerceProfile & { user_id?: number }) | null;
    current_package: { package_id?: string; name?: string; paid_at?: string; pay_amount_fen?: string } | null;
    wallet: { balance_micros?: string; reserved_micros?: string } | null;
    image_quota: { purchased_balance?: number; total_available?: number } | null;
    audio_quota: { subCharQuota?: number; permCharQuota?: number } | null;
    next_tier: { id: string; name: string; threshold_pay_fen: string; remaining_pay_fen: string } | null;
};

export type AiCommerceProfile = {
    effective_recharge_fen: string;
    tier_name_snapshot?: string | null;
    text_free_enabled: boolean;
    video_discount_bps: number;
};

export type AiCommerceSettings = {
    customRechargeEnabled: boolean;
    customRechargeMinimumFen: number;
};

const base = (connection: UserAssetConnection) => `${connection.canvasBaseUrl.replace(/\/+$/, "")}/v1`;
const trimBase = (value: string) => value.replace(/\/+$/, "");
const headers = (connection: UserAssetConnection) => ({ Authorization: `Bearer ${connection.token}` });

export const canvasBillingApi = {
    async memberCenter(connection?: UserAssetConnection | null) {
        const url = connection
            ? `${trimBase(connection.apiBaseUrl)}/ai-commerce/v1/member-center`
            : "/flash-api/ai-commerce/v1/member-center";
        const { data } = await axios.get<AiMemberCenter>(url, connection ? { headers: headers(connection) } : undefined);
        return data;
    },
    async quote(connection: UserAssetConnection, payload: Record<string, unknown>, signal?: AbortSignal) {
        const { data } = await axios.post<CanvasBillingQuote>(`${base(connection)}/billing/quote`, payload, { headers: headers(connection), signal });
        return data;
    },
    async summary(connection: UserAssetConnection) {
        const { data } = await axios.get(`${base(connection)}/billing/summary`, { headers: headers(connection) });
        return data;
    },
    async videoLedger(connection: UserAssetConnection, params: { page?: number; limit?: number; taskId?: string } = {}) {
        const { data } = await axios.get(`${base(connection)}/video/billing/ledger`, { headers: headers(connection), params });
        return data as { total: number; page: number; limit: number; summary: { availableMicros: string; reservedMicros: string; totalSpentMicros: string }; list: Array<Record<string, any>> };
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
    async aiPackages(connection: UserAssetConnection) {
        const { data } = await axios.get<{ items?: AiRechargePackage[] }>(`${trimBase(connection.apiBaseUrl)}/ai-commerce/v1/packages`, { headers: headers(connection) });
        return data.items || [];
    },
    async aiSettings(connection: UserAssetConnection) {
        const { data } = await axios.get<AiCommerceSettings>(`${trimBase(connection.apiBaseUrl)}/ai-commerce/v1/settings`, { headers: headers(connection) });
        return data;
    },
    async aiProfile(connection: UserAssetConnection) {
        const { data } = await axios.get<AiCommerceProfile>(`${trimBase(connection.apiBaseUrl)}/ai-commerce/v1/profile`, { headers: headers(connection) });
        return data;
    },
    async createAiPackageOrder(connection: UserAssetConnection, packageId: string) {
        const { data } = await axios.post<Record<string, unknown>>(`${trimBase(connection.apiBaseUrl)}/ai-commerce/v1/orders/package`, { package_id: packageId }, { headers: headers(connection) });
        return data;
    },
    async createAiCustomOrder(connection: UserAssetConnection, amountFen: number) {
        const { data } = await axios.post<Record<string, unknown>>(`${trimBase(connection.apiBaseUrl)}/ai-commerce/v1/orders/custom`, { amount_fen: Math.round(amountFen) }, { headers: headers(connection) });
        return data;
    },
    async aiOrderStatus(connection: UserAssetConnection, orderNo: string) {
        const { data } = await axios.get<Record<string, unknown>>(`${trimBase(connection.apiBaseUrl)}/ai-commerce/v1/orders/${encodeURIComponent(orderNo)}`, { headers: headers(connection) });
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
    if (quote.maximumAmountMicros === "0" && benefits.some((item) => item.type === "ai_text_free")) return "永久免费使用";
    if (quote.maximumAmountMicros === "0" && benefits.some((item) => item.type === "super_text_free")) return "超级会员免费";
    if (quote.maximumAmountMicros === "0" && benefits.length) return "权益额度抵扣";
    return formatCnyMicros(quote.maximumAmountMicros);
}

export function canvasCompactQuoteLabel(quote: CanvasBillingQuote) {
    const units = Math.max(0, Number(quote.breakdown?.requestUnits || 0));
    const benefits = quote.benefitAllocation || [];
    if (quote.maximumAmountMicros === "0" && benefits.some((item) => item.type === "ai_text_free")) return "永久免费使用";
    if (quote.maximumAmountMicros === "0" && benefits.some((item) => item.type === "super_text_free")) return "免费";
    if (quote.maximumAmountMicros === "0" && benefits.length) return "本次免费";
    if (quote.breakdown?.tierCode) return `¥${(Math.max(0, Number(quote.maximumAmountMicros || 0)) / 1_000_000).toFixed(2)}`;
    return formatCnyMicros(quote.maximumAmountMicros, "");
}
