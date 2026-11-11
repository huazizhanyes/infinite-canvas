import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import type { CanvasVideoTask } from "@/services/api/canvas-video";

const ACTIVE_TASK_STATUSES = new Set(["queued", "submitting", "in_progress", "submission_unknown", "archiving"]);

/** Draft video nodes created by storyboard assembly must never trigger task recovery queries. */
export function shouldRecoverCanvasVideoTask(node: CanvasNodeData) {
    if (node.type !== CanvasNodeType.Video || node.metadata?.content) return false;
    if (node.metadata?.videoSubmissionRejected && !node.metadata.videoTaskId) return false;
    if (node.metadata?.videoTaskId || node.metadata?.generationRequestId || node.metadata?.videoProvider) return true;
    if (node.metadata?.assetStoryboardPreviewNode) return false;
    // Compatibility for storyboard nodes created before the explicit preview marker existed.
    return !(node.metadata?.assetStoryboardSourceId && node.metadata?.status === "idle" && !node.metadata?.videoPhase);
}

/**
 * 历史脏数据自愈：视频已经写进 content，却因为一次失败请求（500/超时/多端并发保存）
 * 把节点标成 error。有内容的节点不该再显示错误态 —— 打开画布时就地改回成功。
 * 幂等：写完 status 变 success，不会再命中。
 */
export function shouldHealDeliveredCanvasVideoNode(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Video
        && node.metadata?.status === "error"
        && Boolean(node.metadata?.content);
}

/** Merge an asynchronous media snapshot without allowing it to overwrite user edits or task state. */
export function mergeHydratedCanvasNode(current: CanvasNodeData, base: CanvasNodeData, hydrated: CanvasNodeData): CanvasNodeData {
    if (current.id !== base.id || hydrated.id !== base.id) return current;
    const currentMeta = current.metadata || {};
    const baseMeta = base.metadata || {};
    const hydratedMeta = hydrated.metadata || {};
    const identityChanged = baseMeta.mediaId || currentMeta.mediaId
        ? baseMeta.mediaId !== currentMeta.mediaId
        : baseMeta.storageKey !== currentMeta.storageKey;
    if (identityChanged) return current;
    const contentChanged = currentMeta.content !== baseMeta.content;
    if (contentChanged) return current;
    const patch: CanvasNodeMetadata = {};
    if (hydratedMeta.content) patch.content = hydratedMeta.content;
    if (hydratedMeta.storageKey) patch.storageKey = hydratedMeta.storageKey;
    if (hydratedMeta.mediaStatus) patch.mediaStatus = hydratedMeta.mediaStatus;
    if (hydratedMeta.mediaId && !currentMeta.mediaId) patch.mediaId = hydratedMeta.mediaId;
    if (!Object.keys(patch).length) return current;
    return {
        ...current,
        metadata: {
            ...currentMeta,
            ...patch,
            status: currentMeta.status,
            errorDetails: currentMeta.errorDetails,
            videoTaskId: currentMeta.videoTaskId,
            generationRequestId: currentMeta.generationRequestId,
        },
    };
}

export function chooseRecoverableCanvasVideoTask(tasks: CanvasVideoTask[], taskId?: string | null, requestId?: string | null) {
    const candidates = requestId ? tasks.filter(task => task.clientRequestId === requestId) : taskId ? tasks.filter((task) => task.id === taskId) : tasks;
    return [...candidates].sort((left, right) => taskRank(left) - taskRank(right) || taskCreatedAt(right) - taskCreatedAt(left))[0] || null;
}

/** 仅旧任务已经失败时接续同一节点的较新任务，不回退到旧成片。 */
export function chooseCanvasVideoNodeRecoveryTask(tasks: CanvasVideoTask[], node: CanvasNodeData, projectId: string) {
    const scoped = tasks.filter(task => task.projectId === projectId && task.nodeId === node.id);
    const requestId = node.metadata?.generationRequestId;
    const taskId = node.metadata?.videoTaskId;
    if (!requestId && !taskId) return [...scoped].sort((a, b) => taskCreatedAt(b) - taskCreatedAt(a))[0] || null;
    const current = chooseRecoverableCanvasVideoTask(scoped, taskId, requestId);
    if (!current || current.status !== "failed") return current;
    const baseline = taskCreatedAt(current);
    if (!baseline) return current;
    return scoped.filter(task => taskCreatedAt(task) > baseline)
        .sort((a, b) => taskCreatedAt(b) - taskCreatedAt(a))[0] || current;
}

function taskRank(task: CanvasVideoTask) {
    if (task.status === "completed" && task.resultUrl) return 0;
    if (ACTIVE_TASK_STATUSES.has(task.status)) return 1;
    if (task.status === "failed") return 2;
    return 3;
}

function taskCreatedAt(task: CanvasVideoTask) {
    const value = (task as CanvasVideoTask & { createdAt?: string | number }).createdAt;
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
}
