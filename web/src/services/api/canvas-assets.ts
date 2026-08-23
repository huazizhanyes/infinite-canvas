import type { Asset } from "@/stores/use-asset-store";

export type CanvasAssetConnection = {
    baseUrl: string;
    token: string;
};

type AssetResponse = { data?: { assets?: Asset[] } | Asset[]; assets?: Asset[] };

const trimBase = (value: string) => value.replace(/\/+$/, "");

export const canvasAssetsApi = {
    async list(connection: CanvasAssetConnection) {
        const response = await request<AssetResponse>(connection, "/v1/assets");
        const data = response.data;
        return Array.isArray(data) ? data : data?.assets || response.assets || [];
    },

    async save(connection: CanvasAssetConnection, asset: Asset) {
        await request(connection, `/v1/assets/${encodeURIComponent(asset.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ asset }),
        });
    },

    async remove(connection: CanvasAssetConnection, assetId: string) {
        await request(connection, `/v1/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
    },
};

async function request<T>(connection: CanvasAssetConnection, path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${connection.token}`);
    const response = await fetch(`${trimBase(connection.baseUrl)}${path}`, { ...init, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message || payload?.error?.message || `资产同步失败 (${response.status})`);
    return payload as T;
}
