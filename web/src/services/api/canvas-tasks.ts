import axios from "axios";
import type { UserAssetConnection } from "./user-assets";
export type CanvasServerTask = {
    id: string; kind: "video" | "image" | "audio" | "text"; requestId: string | null;
    projectId: string | null; nodeId: string | null; projectTitle: string; model: string;
    status: string; progress: number | null; createdAt: string; finishedAt: string | null;
    resultUrls: string[]; error: string | null; billingStatus: string; reservedMicros: string | null; chargedMicros: string | null;
};
export type CanvasTaskPage = { total: number; scope: "active" | "recent"; tasks: CanvasServerTask[]; nextCursor: string | null; observedAt: string };
export async function fetchCanvasTasks(connection: UserAssetConnection, scope: "active" | "recent", cursor?: string | null, signal?: AbortSignal) {
    const response = await axios.get<{ data: CanvasTaskPage }>(`${connection.canvasBaseUrl.replace(/\/+$/, "")}/v1/tasks`, {
        headers: { Authorization: `Bearer ${connection.token}` }, params: { scope, limit: 50, cursor: cursor || undefined }, timeout: 15000, signal,
    });
    return response.data.data;
}
export async function fetchCanvasTaskText(connection: UserAssetConnection, id: string) {
    const response = await axios.get<{ data: { text: string } }>(`${connection.canvasBaseUrl.replace(/\/+$/, "")}/v1/tasks/text/${encodeURIComponent(id)}/result`, { headers: { Authorization: `Bearer ${connection.token}` }, timeout: 15000 });
    return response.data.data.text;
}
