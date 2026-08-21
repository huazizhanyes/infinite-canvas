import { LoaderCircle } from "lucide-react";
import { Tooltip } from "antd";

import type { CanvasBillingQuote } from "@/services/api/canvas-billing";

type CanvasQuoteDisplayProps = {
    quote: CanvasBillingQuote | null;
    state: "idle" | "loading" | "ready" | "error";
    label: string;
    error?: string;
};

export function CanvasQuoteDisplay({ quote, state, label, error }: CanvasQuoteDisplayProps) {
    const failed = quote?.canSubmit === false || state === "error";
    return (
        <Tooltip title={<QuoteDetails quote={quote} state={state} label={label} error={error} />}>
            <span className={`inline-flex h-7 shrink-0 items-center gap-1 px-1 text-[10px] font-medium ${failed ? "text-red-500" : "opacity-60"}`}>
                {state === "loading" ? <LoaderCircle className="size-3 shrink-0 animate-spin" /> : null}
                {label}
            </span>
        </Tooltip>
    );
}

function QuoteDetails({ quote, state, label, error }: CanvasQuoteDisplayProps) {
    if (state === "error") return <span>{error || label}</span>;
    if (!quote) return <span>{label}</span>;
    const image = quote.benefitSummary?.image;
    const requested = Math.max(0, Number(quote.breakdown?.requestUnits || 0));
    const deducted = (quote.benefitAllocation || []).reduce((sum, item) => sum + Math.max(0, Number(item.units || 0)), 0);
    const tier = quote.canvasMembershipTier === "super" ? "超级会员" : quote.canvasMembershipTier === "member" ? "普通会员" : "免费用户";
    const videoTier = quote.breakdown?.tierCode;
    if (videoTier) {
        const tierLabels = { NORMAL: "普通用户", SILVER: "白银", GOLD: "黄金", DIAMOND: "钻石" } as const;
        const yuan = (micros?: string) => `¥${(Number(micros || 0) / 1_000_000).toFixed(2)}`;
        return (
            <div className="min-w-56 space-y-1 py-0.5 text-[11px] leading-4">
                <div className="font-semibold">MiniMax H3 · {tierLabels[videoTier]}</div>
                <div>专属单价：{yuan(quote.breakdown.tierUnitPriceMicros)}/秒</div>
                <div>请求时长：{quote.breakdown.requestedSeconds || 0} 秒</div>
                <div>普通原价：{yuan(quote.breakdown.originalAmountMicros)}</div>
                <div>优惠节省：{yuan(quote.breakdown.savingsMicros)}</div>
                <div className="pt-1 font-semibold">预计扣款：{yuan(quote.breakdown.payableAmountMicros)}</div>
            </div>
        );
    }
    if (!image || !deducted) return <span>本次预计：{label}</span>;
    return (
        <div className="min-w-48 space-y-1 py-0.5 text-[11px] leading-4">
            <div className="font-semibold">{tier}图片权益</div>
            <div>每月额度：{image.monthlyLimit} 张</div>
            <div>本月剩余：{image.monthlyRemaining} 张</div>
            {image.purchasedBalance > 0 ? <div>额外购买：{image.purchasedBalance} 张</div> : null}
            <div className="pt-1 opacity-80">本次生成 {requested} 张，优先抵扣 {deducted} 张。</div>
        </div>
    );
}
