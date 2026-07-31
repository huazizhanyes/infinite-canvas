import axios from 'axios'

export type UserAssetConnection = {
    canvasBaseUrl: string
    apiBaseUrl: string
    token: string
}

export type UserAssetBalance = {
    status: 'active' | 'unavailable'
    unit: string
    totalAvailable?: number
    monthlyGranted?: number
    monthlyRemaining?: number
    purchasedBalance?: number
    reservedBalance?: number
    cycleMonth?: string
    message?: string
    unlimited?: boolean
    membershipName?: string
}

export type UserAssetSummary = {
    user: {
        id: number
        username: string
        displayName: string
        avatarUrl: string
        level: 'free' | 'member' | 'super'
        levelName: string
    }
    assets: {
        image: UserAssetBalance
        text: UserAssetBalance
        audio: UserAssetBalance
        video: UserAssetBalance
    }
}

export type TextTokenPlan = {
    id: string
    name: string
    tokenAmount: number
    price: number
    badge?: string
    isRecommended?: boolean
}

export type TextTokenTransaction = {
    id: number
    type: string
    amount: number
    balanceAfter: number
    platform?: string
    modelKey?: string
    inputTokens?: number
    outputTokens?: number
    description?: string
    createdAt: string
}

export type ImageRechargePlan = {
    id: string
    name: string
    price: number
    credits: number
    badge?: string
    recommended?: boolean
}

export type VideoRechargePlan = ImageRechargePlan

export type RechargeOrder = {
    out_trade_no: string
    qr_url?: string
    code_url?: string
}

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` })
const trimBase = (value: string) => value.replace(/\/+$/, '')

export const userAssetsApi = {
    async getAssets(connection: UserAssetConnection) {
        const { data } = await axios.get<UserAssetSummary>(`${trimBase(connection.canvasBaseUrl)}/v1/me/assets`, { headers: authHeaders(connection.token) })
        return data
    },

    async getTokenPlans(connection: UserAssetConnection) {
        const { data } = await axios.get<{ data?: TextTokenPlan[] }>(`${trimBase(connection.apiBaseUrl)}/text-tokens/recharge-plans`, { headers: authHeaders(connection.token) })
        return data.data || []
    },

    async getTokenTransactions(connection: UserAssetConnection) {
        const { data } = await axios.get<{ data?: { items?: TextTokenTransaction[] } }>(`${trimBase(connection.apiBaseUrl)}/text-tokens/transactions`, {
            headers: authHeaders(connection.token),
            params: { page: 1, limit: 30 },
        })
        return data.data?.items || []
    },

    async getImagePlans(connection: UserAssetConnection) {
        const { data } = await axios.get<{ data?: ImageRechargePlan[] }>(`${trimBase(connection.apiBaseUrl)}/plug/image/recharge-plans`, {
            headers: authHeaders(connection.token),
        })
        return data.data || []
    },

    async createImageOrder(connection: UserAssetConnection, planId: string) {
        const { data } = await axios.post<{ data?: RechargeOrder }>(
            `${trimBase(connection.apiBaseUrl)}/payments/image/create`,
            { plan_id: planId },
            { headers: authHeaders(connection.token) },
        )
        if (!data.data?.out_trade_no) throw new Error('创建图片额度充值订单失败')
        return data.data
    },

    async createTokenOrder(connection: UserAssetConnection, planId: string) {
        const { data } = await axios.post<{ data?: RechargeOrder }>(
            `${trimBase(connection.apiBaseUrl)}/payments/text-token/create`,
            { plan_id: planId },
            { headers: authHeaders(connection.token) },
        )
        if (!data.data?.out_trade_no) throw new Error('创建 Token 充值订单失败')
        return data.data
    },

    async getVideoPlans(connection: UserAssetConnection) {
        const { data } = await axios.get<{ data?: VideoRechargePlan[] }>(`${trimBase(connection.canvasBaseUrl)}/v1/video/recharge-plans`, {
            headers: authHeaders(connection.token),
        })
        return data.data || []
    },

    async createVideoOrder(connection: UserAssetConnection, planId: string) {
        const { data } = await axios.post<{ data?: RechargeOrder }>(
            `${trimBase(connection.apiBaseUrl)}/payments/video/create`,
            { plan_id: planId },
            { headers: authHeaders(connection.token) },
        )
        if (!data.data?.out_trade_no) throw new Error('创建视频积分充值订单失败')
        return data.data
    },

    async getOrderStatus(connection: UserAssetConnection, outTradeNo: string) {
        const { data } = await axios.get<{ data?: { status?: string } }>(`${trimBase(connection.apiBaseUrl)}/payments/orders/${encodeURIComponent(outTradeNo)}/status`, {
            headers: authHeaders(connection.token),
        })
        return data.data?.status || 'pending'
    },
}
