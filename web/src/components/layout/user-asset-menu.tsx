import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { App, Avatar, Button, Drawer, Empty, Grid, Modal, Popover, Spin, Tooltip } from "antd";
import { AudioLines, Image, RefreshCw, UserRound, WalletCards } from "lucide-react";

import { canvasBillingApi, formatCnyMicros, type AiCommerceProfile, type AiCommerceSettings, type AiRechargePackage, type CanvasWalletPlan } from "@/services/api/canvas-billing";
import { userAssetsApi, type ImageRechargePlan } from "@/services/api/user-assets";
import { useUserStore } from "@/stores/use-user-store";
import { requestCanvasLogin } from "@/components/layout/canvas-login-modal";
import { SUCAI_INTEGRATION } from "@/constant/env";

const AUDIO_RECHARGE_URL = "https://peiyin.hzzy.xyz/#/online/subscription";

export function UserAssetMenu({ style }: { style?: CSSProperties }) {
    const { message } = App.useApp();
    const mobile = !Grid.useBreakpoint().sm;
    const user = useUserStore((state) => state.user);
    const summary = useUserStore((state) => state.assets);
    const connection = useUserStore((state) => state.connection);
    const loading = useUserStore((state) => state.loading);
    const loadAssets = useUserStore((state) => state.loadAssets);
    const [open, setOpen] = useState(false);
    const [walletOpen, setWalletOpen] = useState(false);
    const [imageOpen, setImageOpen] = useState(false);
    const [walletPlans, setWalletPlans] = useState<CanvasWalletPlan[]>([]);
    const [aiPackages, setAiPackages] = useState<AiRechargePackage[]>([]);
    const [aiProfile, setAiProfile] = useState<AiCommerceProfile | null>(null);
    const [aiSettings, setAiSettings] = useState<AiCommerceSettings | null>(null);
    const [customAmountYuan, setCustomAmountYuan] = useState(10);
    const [imagePlans, setImagePlans] = useState<ImageRechargePlan[]>([]);
    const [ordering, setOrdering] = useState("");
    const [payment, setPayment] = useState<{ kind: "ai" | "wallet" | "image"; orderNo: string; qrUrl?: string } | null>(null);
    const [ledgerOpen, setLedgerOpen] = useState(false);
    const [ledger, setLedger] = useState<{ summary?: { availableMicros: string; reservedMicros: string; totalSpentMicros: string }; list?: Array<Record<string, any>> } | null>(null);

    const openWallet = async () => {
        if (!connection) return;
        setOpen(false); setWalletOpen(true);
        try {
            const [packages, profile, settings, legacyPlans] = await Promise.all([
                canvasBillingApi.aiPackages(connection), canvasBillingApi.aiProfile(connection), canvasBillingApi.aiSettings(connection), canvasBillingApi.plans(connection),
            ]);
            setAiPackages(packages); setAiProfile(profile); setAiSettings(settings); setWalletPlans(legacyPlans);
        } catch (error) { message.error(readError(error, "AI 充值套餐读取失败")); }
    };
    const openImage = async () => {
        if (!connection) return;
        setOpen(false); setImageOpen(true);
        try { setImagePlans(await userAssetsApi.getImagePlans(connection)); } catch (error) { message.error(readError(error, "图片次数套餐读取失败")); }
    };
    const openLedger = async () => {
        if (!connection) return;
        setOpen(false); setLedgerOpen(true);
        try { setLedger(await canvasBillingApi.videoLedger(connection, { page: 1, limit: 50 })); } catch (error) { message.error(readError(error, "视频额度明细读取失败")); }
    };
    const buyWallet = async (plan: CanvasWalletPlan) => {
        if (!connection) return;
        setOrdering(plan.id);
        try {
            const order = await canvasBillingApi.createOrder(connection, plan.id);
            const orderNo = String(order.out_trade_no || order.orderNo || "");
            if (!orderNo) throw new Error("创建钱包充值订单失败");
            setPayment({ kind: "wallet", orderNo, qrUrl: String(order.qr_url || order.code_url || "") || undefined });
        } catch (error) { message.error(readError(error, "创建钱包充值订单失败")); } finally { setOrdering(""); }
    };
    const buyAiPackage = async (plan: AiRechargePackage) => {
        if (!connection) return;
        setOrdering(`ai-${plan.id}`);
        try {
            const order = await canvasBillingApi.createAiPackageOrder(connection, plan.id);
            const orderNo = String(order.out_trade_no || order.orderNo || "");
            if (!orderNo) throw new Error("创建 AI 套餐订单失败");
            setPayment({ kind: "ai", orderNo, qrUrl: String(order.qr_url || order.code_url || "") || undefined });
        } catch (error) { message.error(readError(error, "创建 AI 套餐订单失败")); } finally { setOrdering(""); }
    };
    const buyAiCustom = async () => {
        if (!connection || !aiSettings) return;
        const amount = Math.max(aiSettings.customRechargeMinimumFen / 100, Number(customAmountYuan) || 0);
        setOrdering("ai-custom");
        try {
            const order = await canvasBillingApi.createAiCustomOrder(connection, Math.round(amount * 100));
            const orderNo = String(order.out_trade_no || order.orderNo || "");
            if (!orderNo) throw new Error("创建自定义充值订单失败");
            setPayment({ kind: "ai", orderNo, qrUrl: String(order.qr_url || order.code_url || "") || undefined });
        } catch (error) { message.error(readError(error, "创建自定义充值订单失败")); } finally { setOrdering(""); }
    };
    const buyImage = async (plan: ImageRechargePlan) => {
        if (!connection) return;
        setOrdering(plan.id);
        try {
            const order = await userAssetsApi.createImageOrder(connection, plan.id);
            setPayment({ kind: "image", orderNo: order.out_trade_no, qrUrl: order.qr_url || order.code_url });
        } catch (error) { message.error(readError(error, "创建图片次数订单失败")); } finally { setOrdering(""); }
    };

    useEffect(() => {
        if (!payment || !connection) return;
        const timer = window.setInterval(() => {
            const status = payment.kind === "ai"
                ? canvasBillingApi.aiOrderStatus(connection, payment.orderNo).then((value) => String(value.status || "pending"))
                : payment.kind === "wallet"
                    ? canvasBillingApi.orderStatus(connection, payment.orderNo).then((value) => String(value.status || "pending"))
                    : userAssetsApi.getOrderStatus(connection, payment.orderNo);
            void status.then((value) => {
                if (value !== "paid") return;
                window.clearInterval(timer); setPayment(null); message.success(payment.kind === "image" ? "图片次数已到账" : "AI 充值已到账"); void loadAssets();
            }).catch(() => undefined);
        }, 2500);
        return () => window.clearInterval(timer);
    }, [connection, loadAssets, message, payment]);

    useEffect(() => {
        const refresh = () => void loadAssets();
        window.addEventListener("canvas-wallet-changed", refresh);
        window.addEventListener("canvas-video-balance-changed", refresh);
        return () => { window.removeEventListener("canvas-wallet-changed", refresh); window.removeEventListener("canvas-video-balance-changed", refresh); };
    }, [loadAssets]);

    const panel = <AssetPanel summary={summary} loading={loading} onRefresh={() => void loadAssets()} onWallet={() => void openWallet()} onImage={() => void openImage()} onLedger={() => void openLedger()} />;
    const trigger = <Tooltip title={user ? "用户资产" : "请先登录"}><button type="button" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-background text-stone-600" style={style} aria-label="用户资产" onClick={() => { if (!user) { if (SUCAI_INTEGRATION) requestCanvasLogin(); return; } if (mobile) { setOpen(true); void loadAssets(); } }}><Avatar size={28} src={user?.avatarUrl || undefined} icon={!user ? <UserRound className="size-4" /> : undefined}>{user?.displayName?.slice(0, 1)}</Avatar></button></Tooltip>;

    return <>
        {!user && SUCAI_INTEGRATION ? trigger : mobile ? trigger : <Popover trigger="click" placement="bottomRight" open={open} onOpenChange={(value) => { setOpen(value); if (value) void loadAssets(); }} content={panel} styles={{ content: { padding: 0 } }}>{trigger}</Popover>}
        <Drawer title="用户资产" placement="right" open={mobile && open} onClose={() => setOpen(false)}>{panel}</Drawer>
        <AiRechargeModal open={walletOpen} loading={loading} packages={aiPackages} profile={aiProfile} settings={aiSettings} customAmountYuan={customAmountYuan} setCustomAmountYuan={setCustomAmountYuan} ordering={ordering} onClose={() => setWalletOpen(false)} onBuyPackage={(plan) => void buyAiPackage(plan)} onCustomRecharge={() => void buyAiCustom()} legacyPlans={walletPlans} onBuyLegacy={(plan) => void buyWallet(plan)} />
        <PlanModal title="购买图片次数" open={imageOpen} loading={loading} plans={imagePlans.map((plan) => ({ id: plan.id, name: plan.name, amount: plan.price, detail: `${plan.credits.toLocaleString("zh-CN")} 张` }))} ordering={ordering} onClose={() => setImageOpen(false)} onBuy={(plan) => void buyImage(imagePlans.find((item) => item.id === plan.id)!)} />
        <VideoLedgerModal open={ledgerOpen} ledger={ledger} loading={loading} onClose={() => setLedgerOpen(false)} onRefresh={openLedger} />
        <Modal title="微信支付" width={360} open={!!payment} onCancel={() => setPayment(null)} footer={null}><div className="flex flex-col items-center py-3 text-center">{payment?.qrUrl ? <img src={payment.qrUrl} alt="微信支付二维码" className="size-64 max-w-full object-contain" /> : <Spin />}<p className="mt-4 text-sm text-stone-500">扫码支付，到账后余额会自动刷新。</p></div></Modal>
    </>;
}

function AiRechargeModal({ open, loading, packages, profile, settings, customAmountYuan, setCustomAmountYuan, ordering, onClose, onBuyPackage, onCustomRecharge, legacyPlans, onBuyLegacy }: { open: boolean; loading: boolean; packages: AiRechargePackage[]; profile: AiCommerceProfile | null; settings: AiCommerceSettings | null; customAmountYuan: number; setCustomAmountYuan: (value: number) => void; ordering: string; onClose: () => void; onBuyPackage: (plan: AiRechargePackage) => void; onCustomRecharge: () => void; legacyPlans: CanvasWalletPlan[]; onBuyLegacy: (plan: CanvasWalletPlan) => void }) {
    return <Modal title="AI 充值中心" width={620} open={open} onCancel={onClose} footer={null}>
        <Spin spinning={loading}>
            {profile ? <div className="mb-4 rounded-md bg-stone-50 p-3 text-sm dark:bg-stone-900"><div>累计有效充值 ¥{(Number(profile.effective_recharge_fen || 0) / 100).toFixed(2)} · {profile.tier_name_snapshot || "未达累计等级"}</div><div className="mt-1 text-stone-500">{profile.text_free_enabled ? "Canvas 文案模型与创作智能体永久免费使用" : "Canvas 文案模型与创作智能体按实际用量计费"} · 视频 {profile.video_discount_bps >= 10000 ? "原价" : `${(profile.video_discount_bps / 1000).toFixed(1)} 折`}</div></div> : null}
            {packages.length ? <div className="grid gap-2 sm:grid-cols-2">{packages.map((plan) => <button key={plan.id} type="button" className="min-h-32 rounded-md border border-stone-200 p-4 text-left transition hover:border-stone-500 dark:border-stone-700" disabled={!!ordering} onClick={() => onBuyPackage(plan)}><div className="flex items-center justify-between gap-2"><strong>{plan.name}</strong>{plan.recommended ? <span className="text-xs text-amber-600">推荐</span> : null}</div>{plan.description ? <div className="mt-1 text-sm text-stone-500">{plan.description}</div> : null}<div className="mt-3 font-semibold">{ordering === `ai-${plan.id}` ? "创建订单中..." : `¥${(Number(plan.version.pay_amount_fen) / 100).toFixed(2)}`}</div><div className="mt-1 text-xs text-stone-500">到账 ¥{(Number(plan.version.wallet_amount_micros) / 1_000_000).toFixed(2)} · 图片 {plan.version.image_quota} · 配音 {plan.version.audio_char_quota}</div></button>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已发布 AI 套餐" />}
            {settings?.customRechargeEnabled ? <div className="mt-4 flex items-center gap-2 border-t border-stone-100 pt-4 dark:border-stone-800"><input aria-label="自定义充值金额" type="number" min={settings.customRechargeMinimumFen / 100} step="1" value={customAmountYuan} onChange={(event) => setCustomAmountYuan(Number(event.target.value))} className="h-9 w-32 rounded-md border border-stone-200 bg-transparent px-2 dark:border-stone-700" /><span className="text-sm text-stone-500">元起，钱包到账等于支付金额</span><Button type="primary" disabled={!!ordering} loading={ordering === "ai-custom"} onClick={onCustomRecharge}>自定义充值</Button></div> : null}
            {legacyPlans.length ? <details className="mt-4 border-t border-stone-100 pt-3 text-sm dark:border-stone-800"><summary className="cursor-pointer text-stone-500">旧版钱包充值档位</summary><div className="mt-2 grid gap-2 sm:grid-cols-2">{legacyPlans.map((plan) => <button key={plan.id} type="button" className="rounded-md border border-stone-200 p-3 text-left dark:border-stone-700" disabled={!!ordering} onClick={() => onBuyLegacy(plan)}><strong>{plan.name}</strong><div className="mt-1 text-stone-500">¥{Number(plan.amount || 0).toFixed(2)}</div></button>)}</div></details> : null}
        </Spin>
    </Modal>;
}

function AssetPanel({ summary, loading, onRefresh, onWallet, onImage, onLedger }: { summary: ReturnType<typeof useUserStore.getState>["assets"]; loading: boolean; onRefresh: () => void; onWallet: () => void; onImage: () => void; onLedger: () => void }) {
    if (!summary) return <div className="flex h-44 w-[350px] items-center justify-center"><Spin spinning={loading} /></div>;
    const wallet = summary.assets.wallet;
    return <div className="w-[350px] max-w-full">
        <div className="flex items-center gap-3 border-b border-stone-200 p-4 dark:border-stone-800"><Avatar size={42} src={summary.user.avatarUrl || undefined}>{summary.user.displayName.slice(0, 1)}</Avatar><div className="min-w-0 flex-1"><div className="truncate font-semibold">{summary.user.displayName}</div><div className="mt-1 text-xs text-stone-500">{summary.user.levelName} · ID {summary.user.id}</div></div><Button type="text" shape="circle" loading={loading} icon={<RefreshCw className="size-4" />} onClick={onRefresh} /></div>
        <div className="space-y-4 p-4">
            <div className="border-b border-stone-100 pb-4 dark:border-stone-800"><div className="flex items-center justify-between text-sm text-stone-500"><span className="inline-flex items-center gap-2"><WalletCards className="size-4" />人民币钱包</span><span><Button type="link" size="small" className="!h-auto !p-0" onClick={onLedger}>视频明细</Button><Button type="link" size="small" className="!h-auto !p-0" onClick={onWallet}>充值</Button></span></div><strong className="mt-2 block text-2xl">{formatCnyMicros(wallet?.availableMicros || "0", "")}</strong><span className="text-xs text-stone-500">冻结 {formatCnyMicros(wallet?.reservedMicros || "0", "")}</span></div>
            <BenefitRow icon={<Image className="size-4" />} label="图片权益" value={`${Number(summary.assets.image.totalAvailable || 0).toLocaleString("zh-CN")} 张`} detail={`月额度 ${Number(summary.assets.image.monthlyRemaining || 0).toLocaleString("zh-CN")} · 已购买 ${Number(summary.assets.image.purchasedBalance || 0).toLocaleString("zh-CN")}`} action={<Button type="link" size="small" className="!h-auto !p-0" onClick={onImage}>购买次数</Button>} />
            <BenefitRow icon={<AudioLines className="size-4" />} label="配音字符权益" value={`${Number(summary.assets.audio.totalAvailable || 0).toLocaleString("zh-CN")} 字符`} detail={`订阅 ${Number(summary.assets.audio.monthlyRemaining || 0).toLocaleString("zh-CN")} · 永久 ${Number(summary.assets.audio.purchasedBalance || 0).toLocaleString("zh-CN")}`} action={<Button type="link" size="small" className="!h-auto !p-0" onClick={() => window.open(AUDIO_RECHARGE_URL, "_blank", "noopener,noreferrer")}>获取额度</Button>} />
        </div>
    </div>;
}

function VideoLedgerModal({ open, ledger, loading, onClose, onRefresh }: { open: boolean; ledger: { summary?: { availableMicros: string; reservedMicros: string; totalSpentMicros: string }; list?: Array<Record<string, any>> } | null; loading: boolean; onClose: () => void; onRefresh: () => void }) {
    return <Modal title="视频额度与消费明细" width={760} open={open} onCancel={onClose} footer={null}><Spin spinning={loading}><div className="mb-4 grid grid-cols-3 gap-2 text-sm"><div className="rounded-md bg-stone-50 p-3 dark:bg-stone-900"><div className="text-stone-500">可用余额</div><strong>{formatCnyMicros(ledger?.summary?.availableMicros || "0", "")}</strong></div><div className="rounded-md bg-stone-50 p-3 dark:bg-stone-900"><div className="text-stone-500">视频冻结</div><strong>{formatCnyMicros(ledger?.summary?.reservedMicros || "0", "")}</strong></div><div className="rounded-md bg-stone-50 p-3 dark:bg-stone-900"><div className="text-stone-500">视频累计实扣</div><strong>{formatCnyMicros(ledger?.summary?.totalSpentMicros || "0", "")}</strong></div></div><div className="mb-2 flex justify-end"><Button icon={<RefreshCw className="size-4" />} onClick={onRefresh}>刷新</Button></div><div className="max-h-[420px] overflow-auto">{ledger?.list?.length ? ledger.list.map((row) => <div key={String(row.taskId)} className="border-b border-stone-100 py-3 text-sm dark:border-stone-800"><div className="flex items-center justify-between"><strong>{String(row.taskId).slice(0, 12)}</strong><span>{String(row.billingStatus || "unknown")}</span></div><div className="mt-1 text-xs text-stone-500">报价 {formatCnyMicros(row.quotedAmountMicros || "0", "")} · 实扣 {formatCnyMicros(row.chargedAmountMicros || "0", "")} · 余额 {row.balanceAfterMicros ? formatCnyMicros(row.balanceAfterMicros, "") : "待结算"}</div><div className="mt-1 text-xs text-stone-500">{row.status === "submission_unknown" ? "提交结果未知，金额已冻结，等待核查" : row.status === "completed" ? "已完成并结算" : row.status === "failed" ? "失败，冻结金额已释放" : "处理中，金额已冻结，尚未最终扣除"}</div></div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无视频消费记录" />}</div></Spin></Modal>;
}

function BenefitRow({ icon, label, value, detail, action }: { icon: ReactNode; label: string; value: string; detail: string; action: ReactNode }) { return <div><div className="flex items-center justify-between text-sm text-stone-500"><span className="inline-flex items-center gap-2">{icon}{label}</span>{action}</div><strong className="mt-1 block">{value}</strong><span className="text-xs text-stone-500">{detail}</span></div>; }
function PlanModal({ title, open, loading, plans, ordering, onClose, onBuy }: { title: string; open: boolean; loading: boolean; plans: Array<{ id: string; name: string; amount: number; detail?: string; badge?: string }>; ordering: string; onClose: () => void; onBuy: (plan: { id: string; name: string; amount: number }) => void }) { return <Modal title={title} width={560} open={open} onCancel={onClose} footer={null}><Spin spinning={loading}>{plans.length ? <div className="grid gap-2 sm:grid-cols-2">{plans.map((plan) => <button key={plan.id} type="button" className="min-h-24 rounded-md border border-stone-200 p-4 text-left transition hover:border-stone-500 dark:border-stone-700" disabled={!!ordering} onClick={() => onBuy(plan)}><strong>{plan.name}</strong>{plan.detail ? <div className="mt-1 text-sm text-stone-500">{plan.detail}</div> : null}<div className="mt-3 font-semibold">{ordering === plan.id ? "创建订单中..." : `¥${Number(plan.amount || 0).toFixed(2)}`}</div></button>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可用充值档位" />}</Spin></Modal>; }
function readError(error: unknown, fallback: string) { const value = error as { response?: { data?: { message?: string } }; message?: string }; return value.response?.data?.message || value.message || fallback; }
