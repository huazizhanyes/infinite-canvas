import { useCallback, useEffect, useState } from "react";
import { App, Button, Drawer, Empty, Grid, Pagination, Spin, Tag, Tooltip } from "antd";
import { ChevronDown, ReceiptText, RefreshCw } from "lucide-react";

import { canvasBillingApi, formatCnyMicros, type CanvasVideoLedger, type CanvasVideoLedgerRow } from "@/services/api/canvas-billing";
import { useUserStore } from "@/stores/use-user-store";

const OPEN_EVENT = "canvas-open-video-spending";
const PAGE_SIZE = 20;

export function openVideoSpendingDrawer() {
    window.dispatchEvent(new Event(OPEN_EVENT));
}

export function VideoSpendingButton({ style }: { style?: React.CSSProperties }) {
    const { message } = App.useApp();
    const mobile = !Grid.useBreakpoint().md;
    const user = useUserStore((state) => state.user);
    const connection = useUserStore((state) => state.connection);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [ledger, setLedger] = useState<CanvasVideoLedger | null>(null);
    const [page, setPage] = useState(1);

    const load = useCallback(async (nextPage = page, silent = false) => {
        if (!connection) return;
        if (!silent) setLoading(true);
        try {
            const result = await canvasBillingApi.videoLedger(connection, { page: nextPage, limit: PAGE_SIZE });
            setLedger(result);
            setPage(result.page || nextPage);
        } catch (error) {
            if (!silent) message.error(readError(error, "积分消耗明细读取失败"));
        } finally {
            if (!silent) setLoading(false);
        }
    }, [connection, message, page]);

    useEffect(() => {
        const show = () => setOpen(true);
        window.addEventListener(OPEN_EVENT, show);
        return () => window.removeEventListener(OPEN_EVENT, show);
    }, []);

    useEffect(() => {
        if (!open || !connection) return;
        void load(1);
    }, [connection, open]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!open || !connection) return;
        const refresh = () => void load(page, true);
        const timer = window.setInterval(refresh, 10_000);
        window.addEventListener("canvas-video-balance-changed", refresh);
        window.addEventListener("canvas-wallet-changed", refresh);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("canvas-video-balance-changed", refresh);
            window.removeEventListener("canvas-wallet-changed", refresh);
        };
    }, [connection, load, open, page]);

    if (!user) return null;
    return <>
        <Tooltip title="查看视频生成积分消耗">
            <button type="button" className="inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-stone-600 transition hover:bg-stone-500/10 hover:text-stone-950 dark:text-stone-300 dark:hover:text-white" style={style} onClick={() => setOpen(true)} aria-label="积分消耗">
                <ReceiptText className="size-4" />
                <span>积分消耗</span>
            </button>
        </Tooltip>
        <Drawer title="积分消耗" placement="right" width={mobile ? "100%" : 760} open={open} onClose={() => setOpen(false)} extra={<Button type="text" icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load(page)}>刷新</Button>}>
            <Spin spinning={loading && !ledger}>
                <LedgerSummary ledger={ledger} />
                <div className="mb-3 flex items-center justify-between text-xs text-stone-500"><span>视频生成消费记录 · 共 {ledger?.total || 0} 条</span><span className="inline-flex items-center gap-1"><i className="size-1.5 rounded-full bg-emerald-500" />每 10 秒自动更新</span></div>
                <div className="overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
                    {ledger?.list?.length ? ledger.list.map((row, index) => <SpendingRow key={row.taskId} row={row} index={index} />) : <Empty className="py-16" image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无视频积分消耗记录" />}
                </div>
                {(ledger?.total || 0) > PAGE_SIZE ? <Pagination className="mt-5 text-right" size="small" current={page} pageSize={PAGE_SIZE} total={ledger?.total || 0} showSizeChanger={false} onChange={(value) => void load(value)} /> : null}
            </Spin>
        </Drawer>
    </>;
}

function LedgerSummary({ ledger }: { ledger: CanvasVideoLedger | null }) {
    const items = [
        ["当前可用余额", ledger?.summary.availableMicros || "0"],
        ["生成中冻结", ledger?.summary.reservedMicros || "0"],
        ["视频累计实扣", ledger?.summary.totalSpentMicros || "0"],
    ];
    return <div className="mb-5 grid grid-cols-3 divide-x divide-stone-200 border-y border-stone-200 py-3 dark:divide-stone-800 dark:border-stone-800">{items.map(([label, value]) => <div key={label} className="px-3 first:pl-0 last:pr-0"><div className="text-xs text-stone-500">{label}</div><strong className="mt-1 block text-base sm:text-lg">{formatCnyMicros(value, "")}</strong></div>)}</div>;
}

function SpendingRow({ row, index }: { row: CanvasVideoLedgerRow; index: number }) {
    const status = taskStatus(row);
    const refs = row.referenceCounts || { images: 0, videos: 0, audios: 0 };
    const charged = Number(row.chargedAmountMicros || 0);
    const frozen = !["settled", "refunded", "expired"].includes(row.billingStatus) ? row.quotedAmountMicros : "0";
    const parameterText = row.parameters && Object.keys(row.parameters).length ? JSON.stringify(row.parameters) : "无扩展参数";
    const rowBackground = index % 2 === 0 ? "bg-transparent" : "bg-stone-500/[0.07] dark:bg-white/[0.035]";
    return <details className={`group border-b border-stone-200 last:border-b-0 dark:border-stone-800 ${rowBackground}`}>
        <summary className="grid cursor-pointer list-none grid-cols-[72px_minmax(0,1fr)_96px_20px] items-center gap-3 px-3 py-3.5 transition-colors hover:bg-stone-500/5 sm:grid-cols-[96px_minmax(0,1fr)_130px_20px]">
            <div className="border-r border-stone-200 pr-3 dark:border-stone-800">
                <div className="text-xs font-medium text-stone-700 dark:text-stone-300">{formatShortDate(row.createdAt)}</div>
                <div className="mt-1 text-[11px] text-stone-500">{formatShortTime(row.createdAt)}</div>
            </div>
            <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5"><strong className="truncate text-sm">{row.modelDisplayName || row.model || "视频模型"}</strong>{row.promotionFree ? <Tag className="m-0 shrink-0" color="green">{row.promotionLabel || "限时免费"}</Tag> : null}</div>
                <div className="mt-1 truncate text-xs text-stone-500">{modeLabel(row.mode)} · {row.quality || "-"} · {row.aspectRatio || "-"} · {row.duration || 0} 秒</div>
            </div>
            <div className="text-right">
                <strong className={`block text-sm ${charged > 0 ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}`}>{charged > 0 ? `-${formatCnyMicros(row.chargedAmountMicros, "")}` : "¥0.0000"}</strong>
                <div className="mt-1 flex items-center justify-end gap-1.5"><Tag className="m-0" color={status.color}>{status.label}</Tag><span className="hidden text-[11px] text-stone-500 sm:inline">{Number(frozen) > 0 ? `冻结 ${formatCnyMicros(frozen, "")}` : billingLabel(row.billingStatus)}</span></div>
            </div>
            <ChevronDown className="size-4 text-stone-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-stone-200 bg-stone-500/[0.035] px-3 py-3 text-xs dark:border-stone-800">
            <div className="grid gap-x-6 sm:grid-cols-2">
                <DetailRow label="普通原价" value={formatCnyMicros(row.originalAmountMicros || row.quotedAmountMicros, "")} />
                <DetailRow label="优惠节省" value={formatCnyMicros(row.savingsMicros || "0", "")} />
                <DetailRow label="结算后余额" value={row.balanceAfterMicros ? formatCnyMicros(row.balanceAfterMicros, "") : "待结算"} />
                <DetailRow label="参考素材" value={`图片 ${refs.images} · 视频 ${refs.videos} · 音频 ${refs.audios}`} />
                <DetailRow label="计费规则" value={`${tierLabel(row.tierCode)} · ${row.billingUnit === "TASK" ? "按任务" : "按秒"} · v${row.pricingVersion || 0}`} />
                <DetailRow label="完成时间" value={row.completedAt ? formatTime(row.completedAt) : "尚未完成"} />
                <DetailRow label="报价结算" value={`报价 ${formatCnyMicros(row.quotedAmountMicros, "")} · 实扣 ${formatCnyMicros(row.chargedAmountMicros, "")} · 释放 ${formatCnyMicros(row.releasedAmountMicros || "0", "")}`} />
                <DetailRow label="活动信息" value={row.promotionFree ? `${row.promotionLabel || "限时免费"}${row.promotionEndsAt ? ` · ${formatTime(row.promotionEndsAt)} 结束` : ""}` : "无免费活动"} />
                <DetailRow label="任务编号" value={row.taskId} mono />
                <DetailRow label="请求编号" value={row.clientRequestId || "-"} mono />
            </div>
            <DetailRow label="生成参数" value={parameterText} wide />
            {row.promptPreview ? <DetailRow label="生成提示" value={row.promptPreview} wide /> : null}
            {row.error?.message ? <DetailRow label="失败原因" value={row.error.message} danger wide /> : null}
        </div>
    </details>;
}

function DetailRow({ label, value, mono = false, danger = false, wide = false }: { label: string; value: string; mono?: boolean; danger?: boolean; wide?: boolean }) { return <div className={`grid min-w-0 grid-cols-[76px_minmax(0,1fr)] gap-2 border-b border-stone-200/70 py-2 last:border-b-0 dark:border-stone-800/70 ${wide ? "sm:grid-cols-[76px_minmax(0,1fr)]" : ""}`}><span className="text-stone-500">{label}</span><span className={`${mono ? "break-all font-mono" : "break-words"} ${danger ? "text-red-500" : "text-stone-700 dark:text-stone-300"}`}>{value}</span></div>; }
function formatTime(value?: string | null) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("zh-CN", { hour12: false }); }
function formatShortDate(value?: string | null) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "-" : `${date.getMonth() + 1}月${date.getDate()}日`; }
function formatShortTime(value?: string | null) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "-" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }); }
function modeLabel(value?: string) { return ({ text2video: "文生视频", image2video: "全能参考", frames2video: "首尾帧", "first-frame-to-video": "首帧生视频" } as Record<string, string>)[value || ""] || value || "视频生成"; }
function tierLabel(value?: string | null) { return ({ NORMAL: "普通用户", SILVER: "白银会员", GOLD: "黄金会员", DIAMOND: "钻石会员" } as Record<string, string>)[value || ""] || "普通用户"; }
function billingLabel(value?: string) { return ({ reserved: "已预占", running: "计费中", settled: "已结算", refunded: "已退回", expired: "已释放", pending: "待计费", free: "免费" } as Record<string, string>)[value || ""] || "处理中"; }
function taskStatus(row: CanvasVideoLedgerRow): { label: string; color: "default" | "processing" | "success" | "error" | "warning" } { const map: Record<string, { label: string; color: "default" | "processing" | "success" | "error" | "warning" }> = { queued: { label: "排队中", color: "default" }, submitting: { label: "提交中", color: "processing" }, submission_unknown: { label: "等待核查", color: "warning" }, in_progress: { label: "生成中", color: "processing" }, archiving: { label: "归档中", color: "processing" }, completed: { label: "已完成", color: "success" }, failed: { label: row.error?.code === "USER_CANCELLED" ? "已取消" : "生成失败", color: "error" } }; return map[row.status] || { label: row.status || "处理中", color: "default" }; }
function readError(error: unknown, fallback: string) { const value = error as { response?: { data?: { message?: string } }; message?: string }; return value.response?.data?.message || value.message || fallback; }
