import { create } from "zustand";
import { userAssetsApi, type UserAssetConnection, type UserAssetSummary } from '@/services/api/user-assets'

export type LocalUser = {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
};

type UserStore = {
    user: LocalUser | null;
    assets: UserAssetSummary | null;
    connection: UserAssetConnection | null;
    loading: boolean;
    error: string;
    configure: (connection: UserAssetConnection) => void;
    setIdentity: (user: LocalUser) => void;
    loadAssets: () => Promise<void>;
    clearSession: () => void;
};

export const useUserStore = create<UserStore>()((set) => ({
    user: null,
    assets: null,
    connection: null,
    loading: false,
    error: '',
    configure: (connection) => set((state) => state.connection?.token === connection.token
        ? { connection }
        : { connection, user: null, assets: null, loading: false, error: '' }),
    setIdentity: (user) => set({ user }),
    loadAssets: async () => {
        const connection = useUserStore.getState().connection
        if (!connection?.token) return
        set({ loading: true, error: '' })
        try {
            const assets = await userAssetsApi.getAssets(connection)
            if (useUserStore.getState().connection?.token !== connection.token) return
            set({
                assets,
                user: {
                    id: String(assets.user.id),
                    username: assets.user.username,
                    displayName: assets.user.displayName,
                    avatarUrl: assets.user.avatarUrl,
                },
                loading: false,
            })
        } catch (error) {
            if (useUserStore.getState().connection?.token !== connection.token) return
            const status = (error as { response?: { status?: number } })?.response?.status
            set({
                loading: false,
                error: status === 401 ? '登录已失效，请重新登录' : error instanceof Error ? error.message : '用户资产读取失败',
                ...(status === 401 ? { user: null, assets: null } : {}),
            })
        }
    },
    clearSession: () => set({ user: null, assets: null, connection: null, error: '' }),
}));
