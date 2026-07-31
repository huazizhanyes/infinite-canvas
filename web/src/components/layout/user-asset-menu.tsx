import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { App, Avatar, Button, Drawer, Empty, Grid, Modal, Popover, Spin, Tag, Tooltip } from 'antd'
import { AudioLines, ExternalLink, Image, RefreshCw, Type, UserRound, Video, WalletCards, X } from 'lucide-react'

import { userAssetsApi, type ImageRechargePlan, type TextTokenPlan, type TextTokenTransaction, type UserAssetBalance, type UserAssetSummary, type VideoRechargePlan } from '@/services/api/user-assets'
import { useUserStore } from '@/stores/use-user-store'

const AUDIO_RECHARGE_URL = 'https://peiyin.hzzy.xyz/#/online/subscription'

export function UserAssetMenu({ style }: { style?: CSSProperties }) {
    const { message } = App.useApp()
    const screens = Grid.useBreakpoint()
    const mobile = !screens.sm
    const user = useUserStore((state) => state.user)
    const summary = useUserStore((state) => state.assets)
    const connection = useUserStore((state) => state.connection)
    const loading = useUserStore((state) => state.loading)
    const error = useUserStore((state) => state.error)
    const loadAssets = useUserStore((state) => state.loadAssets)
    const [open, setOpen] = useState(false)
    const [detailOpen, setDetailOpen] = useState(false)
    const [detailLoading, setDetailLoading] = useState(false)
    const [plans, setPlans] = useState<TextTokenPlan[]>([])
    const [transactions, setTransactions] = useState<TextTokenTransaction[]>([])
    const [orderingPlanId, setOrderingPlanId] = useState('')
    const [imageOpen, setImageOpen] = useState(false)
    const [imagePlanLoading, setImagePlanLoading] = useState(false)
    const [imagePlans, setImagePlans] = useState<ImageRechargePlan[]>([])
    const [imageOrderingPlanId, setImageOrderingPlanId] = useState('')
    const [videoOpen, setVideoOpen] = useState(false)
    const [videoPlanLoading, setVideoPlanLoading] = useState(false)
    const [videoPlans, setVideoPlans] = useState<VideoRechargePlan[]>([])
    const [videoOrderingPlanId, setVideoOrderingPlanId] = useState('')
    const [payment, setPayment] = useState<{ kind: 'image' | 'text' | 'video'; outTradeNo: string; qrUrl?: string } | null>(null)

    const loadTokenDetails = async () => {
        if (!connection) return
        setDetailLoading(true)
        try {
            const [nextPlans, nextTransactions] = await Promise.all([
                userAssetsApi.getTokenPlans(connection),
                userAssetsApi.getTokenTransactions(connection),
            ])
            setPlans(nextPlans)
            setTransactions(nextTransactions)
        } catch (reason) {
            message.error(readError(reason, 'Token 明细读取失败'))
        } finally {
            setDetailLoading(false)
        }
    }

    const openDetails = () => {
        setOpen(false)
        setDetailOpen(true)
        void loadTokenDetails()
    }

    const createOrder = async (plan: TextTokenPlan) => {
        if (!connection) return
        setOrderingPlanId(plan.id)
        try {
            const order = await userAssetsApi.createTokenOrder(connection, plan.id)
            setPayment({ kind: 'text', outTradeNo: order.out_trade_no, qrUrl: order.qr_url || order.code_url })
        } catch (reason) {
            message.error(readError(reason, '创建充值订单失败'))
        } finally {
            setOrderingPlanId('')
        }
    }

    const loadImagePlans = async () => {
        if (!connection) return
        setImagePlanLoading(true)
        try {
            setImagePlans(await userAssetsApi.getImagePlans(connection))
        } catch (reason) {
            message.error(readError(reason, '图片额度充值套餐读取失败'))
        } finally {
            setImagePlanLoading(false)
        }
    }

    const openImageRecharge = () => {
        setOpen(false)
        setImageOpen(true)
        void loadAssets()
        void loadImagePlans()
    }

    const createImageOrder = async (plan: ImageRechargePlan) => {
        if (!connection) return
        setImageOrderingPlanId(plan.id)
        try {
            const order = await userAssetsApi.createImageOrder(connection, plan.id)
            setPayment({ kind: 'image', outTradeNo: order.out_trade_no, qrUrl: order.qr_url || order.code_url })
        } catch (reason) {
            message.error(readError(reason, '创建图片额度充值订单失败'))
        } finally {
            setImageOrderingPlanId('')
        }
    }

    const loadVideoPlans = async () => {
        if (!connection) return
        setVideoPlanLoading(true)
        try { setVideoPlans(await userAssetsApi.getVideoPlans(connection)) } catch (reason) { message.error(readError(reason, '视频积分套餐读取失败')) } finally { setVideoPlanLoading(false) }
    }

    const openVideoRecharge = () => {
        setOpen(false)
        setVideoOpen(true)
        void loadAssets()
        void loadVideoPlans()
    }

    const createVideoOrder = async (plan: VideoRechargePlan) => {
        if (!connection) return
        setVideoOrderingPlanId(plan.id)
        try {
            const order = await userAssetsApi.createVideoOrder(connection, plan.id)
            setPayment({ kind: 'video', outTradeNo: order.out_trade_no, qrUrl: order.qr_url || order.code_url })
        } catch (reason) { message.error(readError(reason, '创建视频积分充值订单失败')) } finally { setVideoOrderingPlanId('') }
    }

    useEffect(() => {
        if (!payment || !connection) return
        const timer = window.setInterval(() => {
            void userAssetsApi.getOrderStatus(connection, payment.outTradeNo).then((status) => {
                if (status !== 'paid') return
                window.clearInterval(timer)
                setPayment(null)
                message.success(payment.kind === 'image' ? '图片额度已到账' : payment.kind === 'video' ? '视频积分已到账' : 'Token 已到账')
                void loadAssets()
                if (payment.kind === 'text') void loadTokenDetails()
            }).catch(() => undefined)
        }, 2500)
        return () => window.clearInterval(timer)
    }, [connection, loadAssets, message, payment])

    useEffect(() => {
        const refresh = () => void loadAssets()
        const openRecharge = () => { setOpen(false); setVideoOpen(true); void loadAssets(); void loadVideoPlans() }
        window.addEventListener('canvas-video-balance-changed', refresh)
        window.addEventListener('canvas-video-recharge-required', openRecharge)
        return () => {
            window.removeEventListener('canvas-video-balance-changed', refresh)
            window.removeEventListener('canvas-video-recharge-required', openRecharge)
        }
    }, [loadAssets, connection])

    const content = (
        <AssetPanel
            summary={summary}
            loading={loading}
            error={error}
            onRefresh={() => void loadAssets()}
            onOpenToken={openDetails}
            onOpenImage={openImageRecharge}
            onOpenAudio={() => window.open(AUDIO_RECHARGE_URL, '_blank', 'noopener,noreferrer')}
            onOpenVideo={openVideoRecharge}
        />
    )
    const trigger = (
        <Tooltip title={user ? '用户资产' : '请先登录'}>
            <button
                type="button"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-background text-stone-600 transition hover:border-stone-400 hover:text-stone-950 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-500 dark:hover:text-white"
                style={style}
                aria-label="用户资产"
                onClick={mobile ? () => { setOpen(true); void loadAssets() } : undefined}
            >
                <Avatar size={28} src={user?.avatarUrl || undefined} icon={!user ? <UserRound className="size-4" /> : undefined}>
                    {user?.displayName?.slice(0, 1)}
                </Avatar>
            </button>
        </Tooltip>
    )

    return (
        <>
            {mobile ? trigger : (
                <Popover
                    trigger="click"
                    placement="bottomRight"
                    open={open}
                    onOpenChange={(next) => { setOpen(next); if (next) void loadAssets() }}
                    content={content}
                    styles={{ content: { padding: 0 } }}
                >
                    {trigger}
                </Popover>
            )}
            <Drawer title="用户资产" placement="right" size="min(92vw, 380px)" open={mobile && open} onClose={() => setOpen(false)}>
                {content}
            </Drawer>
            <ImageQuotaModal
                open={imageOpen}
                summary={summary}
                loading={loading || imagePlanLoading}
                plans={imagePlans}
                orderingPlanId={imageOrderingPlanId}
                onClose={() => setImageOpen(false)}
                onRefresh={() => { void loadAssets(); void loadImagePlans() }}
                onBuy={(plan) => void createImageOrder(plan)}
            />
            <VideoCreditModal open={videoOpen} balance={summary?.assets.video} loading={loading || videoPlanLoading} plans={videoPlans} orderingPlanId={videoOrderingPlanId} onClose={() => setVideoOpen(false)} onRefresh={() => { void loadAssets(); void loadVideoPlans() }} onBuy={(plan) => void createVideoOrder(plan)} />
            <Modal title="文本 Token" width={760} open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} destroyOnHidden>
                <Spin spinning={detailLoading}>
                    <section className="border-y border-stone-200 py-4 dark:border-stone-800">
                        <div className="text-sm text-stone-500">当前可用</div>
                        <div className="mt-1 text-3xl font-semibold">{formatNumber(summary?.assets.text.totalAvailable)} Token</div>
                        <div className="mt-2 text-sm text-stone-500">
                            月赠剩余 {formatNumber(summary?.assets.text.monthlyRemaining)} · 充值余额 {formatNumber(summary?.assets.text.purchasedBalance)}
                        </div>
                    </section>
                    <section className="py-5">
                        <div className="mb-3 flex items-center justify-between">
                            <h3 className="text-base font-semibold">充值套餐</h3>
                            <Button type="text" size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => void loadTokenDetails()}>刷新</Button>
                        </div>
                        {plans.length ? (
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                {plans.map((plan) => (
                                    <button key={plan.id} type="button" className="min-h-20 border border-stone-200 p-3 text-left transition hover:border-stone-500 dark:border-stone-700 dark:hover:border-stone-500" disabled={!!orderingPlanId} onClick={() => void createOrder(plan)}>
                                        <div className="flex items-start justify-between gap-2">
                                            <strong>{formatNumber(plan.tokenAmount)} Token</strong>
                                            {plan.isRecommended ? <Tag color="blue" className="m-0">推荐</Tag> : null}
                                        </div>
                                        <div className="mt-3 text-sm text-stone-500">{orderingPlanId === plan.id ? '创建订单中...' : `¥ ${plan.price.toFixed(2)}`}</div>
                                    </button>
                                ))}
                            </div>
                        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可用充值套餐" />}
                    </section>
                    <section className="border-t border-stone-200 pt-5 dark:border-stone-800">
                        <h3 className="mb-3 text-base font-semibold">最近流水</h3>
                        <div className="max-h-72 overflow-y-auto">
                            {transactions.map((item) => (
                                <div key={item.id} className="flex items-center justify-between gap-4 border-b border-stone-100 py-3 last:border-0 dark:border-stone-800">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-medium">{item.description || transactionName(item.type)}</div>
                                        <div className="mt-1 text-xs text-stone-500">{new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}{item.modelKey ? ` · ${item.modelKey}` : ''}</div>
                                    </div>
                                    <div className={`shrink-0 font-medium ${item.amount > 0 ? 'text-emerald-600' : 'text-stone-900 dark:text-stone-100'}`}>{item.amount > 0 ? '+' : ''}{formatNumber(item.amount)}</div>
                                </div>
                            ))}
                            {!transactions.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Token 流水" /> : null}
                        </div>
                    </section>
                </Spin>
            </Modal>
            <Modal title="微信支付" width={360} open={!!payment} onCancel={() => setPayment(null)} footer={null}>
                <div className="flex flex-col items-center py-3 text-center">
                    {payment?.qrUrl ? <img src={payment.qrUrl} alt="微信支付二维码" className="size-64 max-w-full object-contain" /> : <Spin />}
                    <p className="mt-4 text-sm text-stone-500">请使用微信扫码支付，到账后余额会自动刷新。</p>
                </div>
            </Modal>
        </>
    )
}

function ImageQuotaModal({ open, summary, loading, plans, orderingPlanId, onClose, onRefresh, onBuy }: {
    open: boolean
    summary: UserAssetSummary | null
    loading: boolean
    plans: ImageRechargePlan[]
    orderingPlanId: string
    onClose: () => void
    onRefresh: () => void
    onBuy: (plan: ImageRechargePlan) => void
}) {
    const quota = summary?.assets.image
    return (
        <Modal
            title={<span className="text-lg font-semibold text-white">图片额度</span>}
            width={520}
            open={open}
            onCancel={onClose}
            footer={null}
            destroyOnHidden
            closeIcon={<X className="size-5 text-stone-400" />}
            styles={{
                container: { padding: 0, overflow: 'hidden', background: '#10131a', border: '1px solid rgba(18,199,223,.28)' },
                header: { margin: 0, padding: '20px 24px 12px', background: 'transparent' },
                body: { padding: '0 24px 24px', color: '#edf1f7' },
            }}
        >
            <Spin spinning={loading}>
                <div className="grid gap-4">
                    <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[.045] p-3">
                        <div className="rounded-lg border border-amber-300/50 bg-stone-700 p-1 shadow-[0_0_18px_rgba(250,204,21,.18)]">
                            <Avatar size={54} src={summary?.user.avatarUrl || undefined}>{summary?.user.displayName?.slice(0, 1)}</Avatar>
                        </div>
                        <div className="min-w-0">
                            <strong className="block truncate text-base text-white">{summary?.user.displayName || '用户'}</strong>
                            <span className="mt-1 block text-sm text-stone-400">{summary?.user.levelName || '普通用户'}</span>
                        </div>
                    </div>

                    <div
                        className="grid min-h-32 content-center gap-2 rounded-lg border border-cyan-400/50 p-5 shadow-[0_18px_42px_rgba(0,0,0,.28)]"
                        style={{ background: 'radial-gradient(circle at 90% 0%, rgba(255,220,75,.24), transparent 38%), linear-gradient(135deg, rgba(255,220,75,.16), rgba(18,199,223,.08) 48%, rgba(112,87,255,.12))' }}
                    >
                        <span className="text-sm font-semibold text-stone-300">当前可用</span>
                        <strong className="text-4xl leading-none text-white">{formatNumber(quota?.totalAvailable)} 张</strong>
                        <span className="text-sm font-semibold text-stone-300">本月剩余 {formatNumber(quota?.monthlyRemaining)} 张 · 充值余额 {formatNumber(quota?.purchasedBalance)} 张</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                        {[
                            ['可用总额度', quota?.totalAvailable],
                            ['本月剩余', quota?.monthlyRemaining],
                            ['充值余额', quota?.purchasedBalance],
                        ].map(([label, value]) => (
                            <div key={String(label)} className="grid min-h-20 place-items-center content-center gap-1 rounded-lg border border-white/10 bg-white/[.055] px-2 text-center">
                                <strong className="text-xl text-white">{formatNumber(value as number | undefined)}</strong>
                                <span className="text-xs font-semibold text-stone-400">{label}</span>
                            </div>
                        ))}
                    </div>

                    <div className="flex items-center justify-between">
                        <strong className="text-base text-white">充值图片额度</strong>
                        <Button type="text" className="!text-stone-300" icon={<RefreshCw className="size-4" />} onClick={onRefresh}>刷新</Button>
                    </div>
                    {plans.length ? (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {plans.map((plan) => (
                                <button
                                    key={plan.id}
                                    type="button"
                                    className={`grid min-h-20 place-items-center content-center gap-1 rounded-lg border px-3 transition disabled:cursor-wait disabled:opacity-60 ${plan.recommended ? 'border-amber-400/60 bg-amber-400/15 hover:bg-amber-400/20' : 'border-white/10 bg-white/[.055] hover:border-cyan-400/50 hover:bg-white/[.08]'}`}
                                    disabled={!!orderingPlanId}
                                    onClick={() => onBuy(plan)}
                                >
                                    <strong className="text-lg text-white">{orderingPlanId === plan.id ? '创建中...' : `${formatNumber(plan.credits)} 张`}</strong>
                                    <span className="font-semibold text-amber-300">{Number(plan.price)} 元</span>
                                </button>
                            ))}
                        </div>
                    ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-stone-400">暂无可用充值套餐</span>} />}
                </div>
            </Spin>
        </Modal>
    )
}

function VideoCreditModal({ open, balance, loading, plans, orderingPlanId, onClose, onRefresh, onBuy }: {
    open: boolean
    balance?: UserAssetBalance
    loading: boolean
    plans: VideoRechargePlan[]
    orderingPlanId: string
    onClose: () => void
    onRefresh: () => void
    onBuy: (plan: VideoRechargePlan) => void
}) {
    return (
        <Modal title="视频积分" width={520} open={open} onCancel={onClose} footer={null} destroyOnHidden>
            <Spin spinning={loading}>
                <section className="border-y border-stone-200 py-4 dark:border-stone-800">
                    <div className="text-sm text-stone-500">当前可用</div>
                    <div className="mt-1 text-3xl font-semibold">{formatNumber(balance?.totalAvailable)} 积分</div>
                </section>
                <div className="mb-3 mt-5 flex items-center justify-between"><h3 className="text-base font-semibold">充值套餐</h3><Button type="text" size="small" icon={<RefreshCw className="size-3.5" />} onClick={onRefresh}>刷新</Button></div>
                {plans.length ? <div className="grid gap-2 sm:grid-cols-3">{plans.map((plan) => (
                    <button key={plan.id} type="button" className="min-h-24 rounded-md border border-stone-200 p-3 text-left transition hover:border-stone-500 dark:border-stone-700" disabled={!!orderingPlanId} onClick={() => onBuy(plan)}>
                        <div className="flex items-start justify-between gap-2"><strong>{formatNumber(plan.credits)} 积分</strong>{plan.recommended ? <Tag color="blue" className="m-0">推荐</Tag> : null}</div>
                        <div className="mt-3 text-sm text-stone-500">{orderingPlanId === plan.id ? '创建订单中...' : `¥ ${Number(plan.price).toFixed(2)}`}</div>
                    </button>
                ))}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可用视频积分套餐" />}
            </Spin>
        </Modal>
    )
}

function AssetPanel({ summary, loading, error, onRefresh, onOpenToken, onOpenImage, onOpenAudio, onOpenVideo }: {
    summary: UserAssetSummary | null
    loading: boolean
    error: string
    onRefresh: () => void
    onOpenToken: () => void
    onOpenImage: () => void
    onOpenAudio: () => void
    onOpenVideo: () => void
}) {
    const rows = useMemo(() => summary ? [
        { key: 'image', label: '图片额度', icon: Image, balance: summary.assets.image },
        { key: 'text', label: '文本额度', icon: Type, balance: summary.assets.text },
        { key: 'audio', label: '音频额度', icon: AudioLines, balance: summary.assets.audio },
        { key: 'video', label: '视频额度', icon: Video, balance: summary.assets.video },
    ] : [], [summary])
    if (loading && !summary) return <div className="flex h-44 w-[350px] max-w-full items-center justify-center"><Spin /></div>
    if (!summary) return <div className="w-[350px] max-w-full p-5 text-center text-sm text-stone-500">{error || '请先登录后查看用户资产'}</div>
    return (
        <div className="w-[350px] max-w-full">
            <div className="flex items-center gap-3 border-b border-stone-200 p-4 dark:border-stone-800">
                <Avatar size={42} src={summary.user.avatarUrl || undefined}>{summary.user.displayName.slice(0, 1)}</Avatar>
                <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{summary.user.displayName}</div>
                    <div className="mt-1 text-xs text-stone-500">{summary.user.levelName} · ID {summary.user.id}</div>
                </div>
                <Button type="text" shape="circle" loading={loading} icon={<RefreshCw className="size-4" />} onClick={onRefresh} aria-label="刷新资产" />
            </div>
            <div className="divide-y divide-stone-100 px-4 dark:divide-stone-800">
                {rows.map(({ key, label, icon: Icon, balance }) => (
                    <AssetRow
                        key={key}
                        label={label}
                        icon={<Icon className="size-4" />}
                        balance={balance}
                        action={key === 'image'
                            ? <Button type="link" size="small" className="!h-auto !p-0" icon={<WalletCards className="size-3.5" />} onClick={onOpenImage}>去充值</Button>
                            : key === 'text'
                                ? <Button type="link" size="small" className="!h-auto !p-0" icon={<WalletCards className="size-3.5" />} onClick={onOpenToken}>充值与明细</Button>
                                : key === 'audio'
                                    ? <Button type="link" size="small" className="!h-auto !p-0" icon={<ExternalLink className="size-3.5" />} onClick={onOpenAudio}>去充值</Button>
                                    : <Button type="link" size="small" className="!h-auto !p-0" icon={<WalletCards className="size-3.5" />} onClick={onOpenVideo}>充值</Button>}
                    />
                ))}
            </div>
        </div>
    )
}

function AssetRow({ label, icon, balance, action }: { label: string; icon: ReactNode; balance: UserAssetBalance; action?: ReactNode }) {
    const unavailable = balance.status === 'unavailable'
    const value = unavailable
        ? balance.message
        : balance.unlimited
            ? `无限${balance.unit}`
            : `${formatNumber(balance.totalAvailable)} ${balance.unit}`
    return (
        <div className="py-3.5">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-stone-500">{icon}<span>{label}</span></div>
                <strong className="text-sm">{value}</strong>
            </div>
            {!unavailable ? (
                <div className="mt-1.5 flex items-center justify-between gap-3 pl-6 text-xs text-stone-500">
                    <span className="min-w-0 truncate">{balance.unlimited ? `${balance.membershipName || '永久会员'} · 不限字符` : balance.unit === '积分' ? `独立视频积分账户` : `月赠剩余 ${formatNumber(balance.monthlyRemaining)} · 充值/永久 ${formatNumber(balance.purchasedBalance)}`}</span>
                    {action ? <span className="shrink-0">{action}</span> : null}
                </div>
            ) : null}
        </div>
    )
}

function formatNumber(value?: number) {
    return Number(value || 0).toLocaleString('zh-CN')
}

function transactionName(type: string) {
    return ({ MONTHLY_GRANT: '每月赠送', PURCHASE: 'Token 充值', ADMIN_GRANT: '管理员赠送', CONSUME: '文本生成', ADJUST: '后台调整' } as Record<string, string>)[type] || type
}

function readError(error: unknown, fallback: string) {
    const reason = error as { response?: { data?: { message?: string } }; message?: string }
    return reason?.response?.data?.message || reason?.message || fallback
}
