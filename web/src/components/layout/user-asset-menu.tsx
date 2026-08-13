import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { App, Avatar, Button, Drawer, Empty, Grid, Modal, Popover, Spin, Tooltip } from "antd";
import { AudioLines, Image, RefreshCw, UserRound, WalletCards } from "lucide-react";

import { canvasBillingApi, formatCnyMicros, type CanvasWalletPlan } from "@/services/api/canvas-billing";
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
    const [imagePlans, setImagePlans] = useState<ImageRechargePlan[]>([]);
    const [ordering, setOrdering] = useState("");
    const [payment, setPayment] = useState<{ kind: "wallet" | "image"; orderNo: string; qrUrl?: string } | null>(null);

    const openWallet = async () => {
        if (!connection) return;
        setOpen(false); setWalletOpen(true);
        try { setWalletPlans(await canvasBillingApi.plans(connection)); } catch (error) { message.error(readError(error, "钱包充值档位读取失败")); }
    };
    const openImage = async () => {
        if (!connection) return;
        setOpen(false); setImageOpen(true);
        try { setImagePlans(await userAssetsApi.getImagePlans(connection)); } catch (error) { message.error(readError(error, "图片次数套餐读取失败")); }
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
            const status = payment.kind === "wallet"
                ? canvasBillingApi.orderStatus(connection, payment.orderNo).then((value) => String(value.status || "pending"))
                : userAssetsApi.getOrderStatus(connection, payment.orderNo);
            void status.then((value) => {
                if (value !== "paid") return;
                window.clearInterval(timer); setPayment(null); message.success(payment.kind === "wallet" ? "钱包余额已到账" : "图片次数已到账"); void loadAssets();
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

    const panel = <AssetPanel summary={summary} loading={loading} onRefresh={() => void loadAssets()} onWallet={() => void openWallet()} onImage={() => void openImage()} />;
    const trigger = <Tooltip title={user ? "用户资产" : "请先登录"}><button type="button" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-background text-stone-600" style={style} aria-label="用户资产" onClick={() => { if (!user) { if (SUCAI_INTEGRATION) requestCanvasLogin(); return; } if (mobile) { setOpen(true); void loadAssets(); } }}><Avatar size={28} src={user?.avatarUrl || undefined} icon={!user ? <UserRound className="size-4" /> : undefined}>{user?.displayName?.slice(0, 1)}</Avatar></button></Tooltip>;

    return <>
        {!user && SUCAI_INTEGRATION ? trigger : mobile ? trigger : <Popover trigger="click" placement="bottomRight" open={open} onOpenChange={(value) => { setOpen(value); if (value) void loadAssets(); }} content={panel} styles={{ content: { padding: 0 } }}>{trigger}</Popover>}
        <Drawer title="用户资产" placement="right" open={mobile && open} onClose={() => setOpen(false)}>{panel}</Drawer>
        <PlanModal title="人民币钱包充值" open={walletOpen} loading={loading} plans={walletPlans.map((plan) => ({ id: plan.id, name: plan.name, amount: Number(plan.amount), detail: plan.description }))} ordering={ordering} onClose={() => setWalletOpen(false)} onBuy={(plan) => void buyWallet(walletPlans.find((item) => item.id === plan.id)!)} />
        <PlanModal title="购买图片次数" open={imageOpen} loading={loading} plans={imagePlans.map((plan) => ({ id: plan.id, name: plan.name, amount: plan.price, detail: `${plan.credits.toLocaleString("zh-CN")} 张` }))} ordering={ordering} onClose={() => setImageOpen(false)} onBuy={(plan) => void buyImage(imagePlans.find((item) => item.id === plan.id)!)} />
        <Modal title="微信支付" width={360} open={!!payment} onCancel={() => setPayment(null)} footer={null}><div className="flex flex-col items-center py-3 text-center">{payment?.qrUrl ? <img src={payment.qrUrl} alt="微信支付二维码" className="size-64 max-w-full object-contain" /> : <Spin />}<p className="mt-4 text-sm text-stone-500">扫码支付，到账后余额会自动刷新。</p></div></Modal>
    </>;
}

function AssetPanel({ summary, loading, onRefresh, onWallet, onImage }: { summary: ReturnType<typeof useUserStore.getState>["assets"]; loading: boolean; onRefresh: () => void; onWallet: () => void; onImage: () => void }) {
    if (!summary) return <div className="flex h-44 w-[350px] items-center justify-center"><Spin spinning={loading} /></div>;
    const wallet = summary.assets.wallet;
    return <div className="w-[350px] max-w-full">
        <div className="flex items-center gap-3 border-b border-stone-200 p-4 dark:border-stone-800"><Avatar size={42} src={summary.user.avatarUrl || undefined}>{summary.user.displayName.slice(0, 1)}</Avatar><div className="min-w-0 flex-1"><div className="truncate font-semibold">{summary.user.displayName}</div><div className="mt-1 text-xs text-stone-500">{summary.user.levelName} · ID {summary.user.id}</div></div><Button type="text" shape="circle" loading={loading} icon={<RefreshCw className="size-4" />} onClick={onRefresh} /></div>
        <div className="space-y-4 p-4">
            <div className="border-b border-stone-100 pb-4 dark:border-stone-800"><div className="flex items-center justify-between text-sm text-stone-500"><span className="inline-flex items-center gap-2"><WalletCards className="size-4" />人民币钱包</span><Button type="link" size="small" className="!h-auto !p-0" onClick={onWallet}>充值</Button></div><strong className="mt-2 block text-2xl">{formatCnyMicros(wallet?.availableMicros || "0", "")}</strong><span className="text-xs text-stone-500">冻结 {formatCnyMicros(wallet?.reservedMicros || "0", "")}</span></div>
            <BenefitRow icon={<Image className="size-4" />} label="图片权益" value={`${Number(summary.assets.image.totalAvailable || 0).toLocaleString("zh-CN")} 张`} detail={`月额度 ${Number(summary.assets.image.monthlyRemaining || 0).toLocaleString("zh-CN")} · 已购买 ${Number(summary.assets.image.purchasedBalance || 0).toLocaleString("zh-CN")}`} action={<Button type="link" size="small" className="!h-auto !p-0" onClick={onImage}>购买次数</Button>} />
            <BenefitRow icon={<AudioLines className="size-4" />} label="配音字符权益" value={`${Number(summary.assets.audio.totalAvailable || 0).toLocaleString("zh-CN")} 字符`} detail={`订阅 ${Number(summary.assets.audio.monthlyRemaining || 0).toLocaleString("zh-CN")} · 永久 ${Number(summary.assets.audio.purchasedBalance || 0).toLocaleString("zh-CN")}`} action={<Button type="link" size="small" className="!h-auto !p-0" onClick={() => window.open(AUDIO_RECHARGE_URL, "_blank", "noopener,noreferrer")}>获取额度</Button>} />
        </div>
    </div>;
}

function BenefitRow({ icon, label, value, detail, action }: { icon: ReactNode; label: string; value: string; detail: string; action: ReactNode }) { return <div><div className="flex items-center justify-between text-sm text-stone-500"><span className="inline-flex items-center gap-2">{icon}{label}</span>{action}</div><strong className="mt-1 block">{value}</strong><span className="text-xs text-stone-500">{detail}</span></div>; }
function PlanModal({ title, open, loading, plans, ordering, onClose, onBuy }: { title: string; open: boolean; loading: boolean; plans: Array<{ id: string; name: string; amount: number; detail?: string; badge?: string }>; ordering: string; onClose: () => void; onBuy: (plan: { id: string; name: string; amount: number }) => void }) { return <Modal title={title} width={560} open={open} onCancel={onClose} footer={null}><Spin spinning={loading}>{plans.length ? <div className="grid gap-2 sm:grid-cols-2">{plans.map((plan) => <button key={plan.id} type="button" className="min-h-24 rounded-md border border-stone-200 p-4 text-left transition hover:border-stone-500 dark:border-stone-700" disabled={!!ordering} onClick={() => onBuy(plan)}><strong>{plan.name}</strong>{plan.detail ? <div className="mt-1 text-sm text-stone-500">{plan.detail}</div> : null}<div className="mt-3 font-semibold">{ordering === plan.id ? "创建订单中..." : `¥${Number(plan.amount || 0).toFixed(2)}`}</div></button>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可用充值档位" />}</Spin></Modal>; }
function readError(error: unknown, fallback: string) { const value = error as { response?: { data?: { message?: string } }; message?: string }; return value.response?.data?.message || value.message || fallback; }
