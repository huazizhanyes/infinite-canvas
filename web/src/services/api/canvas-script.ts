import axios from "axios";

import type { UserAssetConnection } from "@/services/api/user-assets";

export type ScriptAssetType = "character" | "scene" | "prop";

export type ScriptEpisode = {
    id: string;
    episodeNo: number;
    title: string;
    content: string;
    contentHash?: string;
    currentAnalysisRunId?: string;
    updatedAt: string;
};

export type ScriptSet = {
    id: string;
    projectId: string;
    nodeId: string;
    title: string;
    visualStyle: string;
    aspectRatio: string;
    imageQuality: string;
    episodes: ScriptEpisode[];
    stats: {
        episodeCount: number;
        assetCounts: Record<ScriptAssetType, number>;
        pendingCount: number;
    };
    updatedAt: string;
};

export type ScriptAssetImage = { id: string; imageUrl: string; status: string; selected: boolean };

export type ScriptAssetVariant = {
    id: string;
    name: string;
    state: Record<string, unknown>;
    visualDescription: string;
    imagePrompt: string;
    image: ScriptAssetImage | null;
};

export type ScriptAsset = {
    id: string;
    type: ScriptAssetType;
    name: string;
    aliases: string[];
    identity: Record<string, unknown>;
    visualDescription: string;
    imagePrompt: string;
    manuallyEdited: boolean;
    status: string;
    firstEpisodeId?: string;
    mentionCount: number;
    image: ScriptAssetImage | null;
    variants: ScriptAssetVariant[];
};

export type ScriptPendingMention = {
    id: string;
    episodeId: string;
    episodeTitle?: string;
    assetType: ScriptAssetType;
    extractedName: string;
    extracted: Record<string, unknown>;
    sourceExcerpt?: string;
    matchStatus: string;
    confidence: number;
    suggestedAsset: ScriptAsset | null;
};

export type ScriptAnalysisRun = {
    id: string;
    episodeId: string;
    status: "queued" | "running" | "succeeded" | "failed" | "canceled";
    estimatedTokens: number;
    inputTokens: number;
    outputTokens: number;
    chargedTokens: number;
    error?: string;
};

export type ScriptGenerationImage = {
    id: string;
    assetId: string;
    variantId?: string;
    taskId?: string;
    assetType: ScriptAssetType;
    assetName: string;
    status: string;
    imageUrl?: string;
    selected: boolean;
    error?: string;
};

export type ScriptGenerationBatch = {
    id: string;
    scriptSetId: string;
    status: "running" | "success" | "partial" | "failed";
    requestedCount: number;
    successCount: number;
    failedCount: number;
    images: ScriptGenerationImage[];
};

type ApiResponse<T> = { code: number; data: T };

const headers = (connection: UserAssetConnection) => ({ Authorization: `Bearer ${connection.token}` });
const base = (connection: UserAssetConnection) => `${connection.canvasBaseUrl.replace(/\/+$/, "")}/v1`;

async function request<T>(connection: UserAssetConnection, method: "get" | "post" | "put" | "delete", path: string, data?: unknown, params?: Record<string, unknown>) {
    const response = await axios.request<ApiResponse<T>>({ method, url: `${base(connection)}${path}`, data, params, headers: headers(connection) });
    return response.data.data;
}

export const canvasScriptApi = {
    createSet: (connection: UserAssetConnection, data: { projectId: string; nodeId: string; title?: string; visualStyle?: string }) => request<ScriptSet>(connection, "post", "/script-sets", data),
    getSet: (connection: UserAssetConnection, id: string) => request<ScriptSet>(connection, "get", `/script-sets/${id}`),
    updateSet: (connection: UserAssetConnection, id: string, data: Partial<Pick<ScriptSet, "title" | "visualStyle" | "aspectRatio" | "imageQuality">>) => request<ScriptSet>(connection, "put", `/script-sets/${id}`, data),
    deleteSet: (connection: UserAssetConnection, id: string) => request<{ success: boolean }>(connection, "delete", `/script-sets/${id}`),
    createEpisode: (connection: UserAssetConnection, setId: string) => request<ScriptEpisode>(connection, "post", `/script-sets/${setId}/episodes`, {}),
    updateEpisode: (connection: UserAssetConnection, id: string, data: { title?: string; content?: string }) => request<ScriptEpisode>(connection, "put", `/script-episodes/${id}`, data),
    deleteEpisode: (connection: UserAssetConnection, id: string) => request<{ success: boolean }>(connection, "delete", `/script-episodes/${id}`),
    analyzeEpisode: (connection: UserAssetConnection, id: string, requestId: string, model?: string) => request<ScriptAnalysisRun>(connection, "post", `/script-episodes/${id}/analyze`, { requestId, model }),
    getAnalysis: (connection: UserAssetConnection, id: string) => request<ScriptAnalysisRun>(connection, "get", `/script-analysis/${id}`),
    listAssets: (connection: UserAssetConnection, setId: string, type?: ScriptAssetType) => request<{ assets: ScriptAsset[]; pending: ScriptPendingMention[] }>(connection, "get", `/script-sets/${setId}/assets`, undefined, type ? { type } : undefined),
    archiveAssets: async (connection: UserAssetConnection, setId: string) => {
        const { assets } = await canvasScriptApi.listAssets(connection, setId);
        await Promise.all(assets.map((asset) => canvasScriptApi.updateAsset(connection, asset.id, { status: "archived" })));
        return assets.length;
    },
    updateAsset: (connection: UserAssetConnection, id: string, data: Partial<Pick<ScriptAsset, "name" | "aliases" | "identity" | "visualDescription" | "imagePrompt" | "status">>) => request<ScriptAsset>(connection, "put", `/script-assets/${id}`, data),
    mergeAsset: (connection: UserAssetConnection, id: string, sourceAssetId: string) => request(connection, "post", `/script-assets/${id}/merge`, { sourceAssetId }),
    resolveMention: (connection: UserAssetConnection, id: string, decision: "reuse" | "variant" | "new", assetId?: string) => request<ScriptPendingMention>(connection, "post", `/script-mentions/${id}/resolve`, { decision, assetId }),
    generateAssets: (connection: UserAssetConnection, scriptSetId: string, targets: Array<{ assetId: string; variantId?: string }>, requestId: string, model?: string, quoteToken?: string) => request<ScriptGenerationBatch>(connection, "post", "/script-assets/generate", { scriptSetId, targets, requestId, model, quoteToken }),
    getGenerationBatch: (connection: UserAssetConnection, id: string) => request<ScriptGenerationBatch>(connection, "get", `/script-assets/generation-batches/${id}`),
};

export function notifyScriptSetUpdated(scriptSetId: string) {
    window.dispatchEvent(new CustomEvent("canvas-script-set-updated", { detail: { scriptSetId } }));
}
