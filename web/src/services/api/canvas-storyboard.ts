import axios from "axios";
import type { UserAssetConnection } from "@/services/api/user-assets";

export type StoryboardShot = { id: string; sceneId: string; shotNo: number; title: string; durationSec: number; shotSize: string; cameraAngle: string; cameraMovement: string; visualDescription: string; characterAction: string; dialogue: string; narration: string; sound: string; music: string; transition: string; continuity: string; imagePrompt: string; videoPrompt: string; sourceExcerpt: string; lockedFields: Record<string, boolean>; needsReview: boolean };
export type StoryboardScene = { id: string; sceneNo: number; title: string; location: string; time: string; interior: string; purpose: string; sourceExcerpt: string; shots: StoryboardShot[] };
export type Storyboard = { id: string; projectId: string; nodeId: string; sourceNodeId: string; sourceScope: "full" | "selection"; title: string; style: string; aspectRatio: string; density: "concise" | "standard" | "detailed"; targetDuration?: number | null; status: string; currentRunId?: string; scenes: StoryboardScene[] };
export type StoryboardRun = { id: string; storyboardId: string; status: "queued" | "running" | "succeeded" | "failed" | "canceled"; estimatedTokens: number; inputTokens: number; outputTokens: number; chargedTokens: number; error?: string; resultSummary?: { sceneCount?: number; shotCount?: number } };
type Response<T> = { code: number; data: T };
const headers = (connection: UserAssetConnection) => ({ Authorization: `Bearer ${connection.token}` });
const base = (connection: UserAssetConnection) => `${connection.canvasBaseUrl.replace(/\/+$/, "")}/v1`;
async function request<T>(connection: UserAssetConnection, method: "get" | "post" | "put" | "delete", path: string, data?: unknown) { const response = await axios.request<Response<T>>({ method, url: `${base(connection)}${path}`, data, headers: headers(connection) }); return response.data.data; }
export const canvasStoryboardApi = {
    create: (c: UserAssetConnection, data: Record<string, unknown>) => request<Storyboard>(c, "post", "/storyboards", data),
    get: (c: UserAssetConnection, id: string) => request<Storyboard>(c, "get", `/storyboards/${id}`),
    update: (c: UserAssetConnection, id: string, data: Record<string, unknown>) => request<Storyboard>(c, "put", `/storyboards/${id}`, data),
    remove: (c: UserAssetConnection, id: string) => request<{ success: boolean }>(c, "delete", `/storyboards/${id}`),
    estimate: (c: UserAssetConnection, id: string, data: Record<string, unknown>) => request<{ model: string; estimatedInputTokens: number; estimatedOutputTokens: number; estimatedTotalTokens: number; availableTokens: number }>(c, "post", `/storyboards/${id}/analyze/estimate`, data),
    analyze: (c: UserAssetConnection, id: string, data: Record<string, unknown>) => request<StoryboardRun>(c, "post", `/storyboards/${id}/analyze`, data),
    analysis: (c: UserAssetConnection, id: string) => request<StoryboardRun>(c, "get", `/storyboard-analysis/${id}`),
    scenes: (c: UserAssetConnection, id: string) => request<StoryboardScene[]>(c, "get", `/storyboards/${id}/scenes`),
    updateScene: (c: UserAssetConnection, id: string, data: Record<string, unknown>) => request<StoryboardScene>(c, "put", `/storyboard-scenes/${id}`, data),
    reanalyzeScene: (c: UserAssetConnection, id: string, data: Record<string, unknown>) => request<StoryboardRun>(c, "post", `/storyboard-scenes/${id}/reanalyze`, data),
    updateShot: (c: UserAssetConnection, id: string, data: Record<string, unknown>) => request<StoryboardShot>(c, "put", `/storyboard-shots/${id}`, data),
    duplicateShot: (c: UserAssetConnection, id: string) => request<StoryboardShot>(c, "post", `/storyboard-shots/${id}/duplicate`, {}),
    splitShot: (c: UserAssetConnection, id: string) => request<StoryboardShot>(c, "post", `/storyboard-shots/${id}/split`, {}),
    mergeShot: (c: UserAssetConnection, id: string, withShotId: string) => request<{ success: boolean }>(c, "post", `/storyboard-shots/${id}/merge`, { withShotId }),
    export: (c: UserAssetConnection, id: string, format: "md" | "csv" | "json") => request<{ filename: string; content: string; mimeType: string }>(c, "post", `/storyboards/${id}/export`, { format }),
};
export function notifyStoryboardUpdated(storyboardId: string) { window.dispatchEvent(new CustomEvent("canvas-storyboard-updated", { detail: { storyboardId } })); }
