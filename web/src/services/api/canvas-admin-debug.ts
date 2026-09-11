import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasNodeData } from "@/types/canvas";

export type AdminCanvasProjectSummary = {
    id: string;
    title?: string;
    version?: number;
    created_at?: string;
    updated_at?: string;
    deleted_at?: string | null;
};

export type AdminCanvasTaskDiagnostic = {
    nodeId?: string;
    taskId?: string;
    status?: string;
    error?: { code?: string; message?: string } | null;
    resultUrl?: string | null;
};

export type AdminCanvasSnapshot = {
    project: CanvasProject;
    sourceUserId: string;
    sourceProjectId: string;
    capturedAt?: string;
    diagnostics: AdminCanvasTaskDiagnostic[];
};

type AdminResponse<T> = { data?: T; message?: string; error?: { message?: string } };

const DEBUG_TOKEN_KEY = "infinite-canvas:admin-debug-token";

/**
 * 管理端接口和画布接口挂在同一后端但属于两套认证：/admin/* 需要管理员账号签发的 JWT，
 * 画布会话 token（audio_user）不通用，所以调试页单独保存管理员令牌。
 */
export function readAdminDebugToken() {
    try {
        return sessionStorage.getItem(DEBUG_TOKEN_KEY) || "";
    } catch {
        return "";
    }
}

export function saveAdminDebugToken(token: string) {
    try {
        if (token) sessionStorage.setItem(DEBUG_TOKEN_KEY, token);
        else sessionStorage.removeItem(DEBUG_TOKEN_KEY);
    } catch {
        // 浏览器禁用存储时保持内存态即可，不影响本次使用。
    }
}

function baseUrl() {
    const explicit = String(import.meta.env.VITE_SUCAI_ADMIN_API_BASE || "").trim();
    if (explicit) return explicit.replace(/\/+$/, "");
    return String(import.meta.env.VITE_SUCAI_API_BASE || "").trim().replace(/\/+$/, "");
}

async function request<T>(token: string, path: string, init?: RequestInit) {
    if (!baseUrl()) throw new Error("未配置管理端接口地址");
    if (!token) throw new Error("请先填写管理员令牌");
    const headers = new Headers(init?.headers);
    headers.set("Authorization", "Bearer " + token);
    if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(baseUrl() + path, { ...init, headers });
    const payload = (await response.json().catch(() => ({}))) as AdminResponse<T>;
    if (!response.ok) throw new Error(payload.message || payload.error?.message || "管理端接口请求失败（" + response.status + "）");
    return payload.data as T;
}

export const canvasAdminDebugApi = {
    /** 读取指定用户的画布项目列表。 */
    async listProjects(token: string, userId: string) {
        const data = await request<{ list?: AdminCanvasProjectSummary[] }>(
            token,
            "/admin/canvas/projects?userId=" + encodeURIComponent(userId) + "&page=1&pageSize=50",
        );
        return data?.list || [];
    },
    /** 读取项目元信息与完整画布内容；内容读取会在管理端写入审计日志。 */
    async getProject(token: string, userId: string, projectId: string): Promise<AdminCanvasSnapshot> {
        const [meta, content] = await Promise.all([
            request<{ title?: string; version?: number; updated_at?: string }>(token, "/admin/canvas/projects/" + encodeURIComponent(projectId)),
            request<{ content?: CanvasProject | null }>(token, "/admin/content-access", {
                method: "POST",
                body: JSON.stringify({ resourceType: "canvas_project", resourceId: projectId, field: "data_json" }),
            }),
        ]);
        const project = content?.content;
        if (!project || !Array.isArray(project.nodes)) throw new Error("管理端未返回画布内容，请确认令牌属于管理员账号");
        return {
            project: { ...project, title: project.title || meta?.title || "未命名画布" },
            sourceUserId: userId,
            sourceProjectId: projectId,
            capturedAt: meta?.updated_at,
            diagnostics: buildVideoDiagnostics(project.nodes),
        };
    },
    /** 代看画布媒体地址；失败返回空串，由调用方按媒体缺失降级处理。 */
    async resolveMediaUrl(token: string, mediaId: string) {
        if (!mediaId || !token) return "";
        try {
            const data = await request<{ url?: string }>(token, "/admin/content-access", {
                method: "POST",
                body: JSON.stringify({ resourceType: "canvas_media", resourceId: mediaId, field: "url" }),
            });
            return String(data?.url || "");
        } catch {
            return "";
        }
    },
    /** 只读调试副本的媒体解析入口：自动使用当前浏览器保存的管理员令牌。 */
    async resolveDebugCopyMediaUrl(mediaId: string) {
        return this.resolveMediaUrl(readAdminDebugToken(), mediaId);
    },
};

function buildVideoDiagnostics(nodes: CanvasNodeData[]): AdminCanvasTaskDiagnostic[] {
    return nodes
        .filter((node) => node.type === "video" && node.metadata?.videoTaskId)
        .map((node) => ({
            nodeId: node.id,
            taskId: node.metadata?.videoTaskId,
            status: node.metadata?.content ? "completed" : node.metadata?.videoErrorMessage ? "failed" : "unknown",
            error: node.metadata?.videoErrorMessage ? { code: node.metadata?.videoErrorCode, message: node.metadata?.videoErrorMessage } : null,
            resultUrl: node.metadata?.content || null,
        }));
}
