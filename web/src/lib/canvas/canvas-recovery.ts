import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { CanvasVideoTask } from "@/services/api/canvas-video";

const ACTIVE_TASK_STATUSES = new Set(["queued", "in_progress", "submission_unknown", "archiving"]);

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

export function chooseRecoverableCanvasVideoTask(tasks: CanvasVideoTask[], taskId?: string | null) {
    const candidates = taskId ? tasks.filter((task) => task.id === taskId) : tasks;
    return [...candidates].sort((left, right) => taskRank(left) - taskRank(right) || taskCreatedAt(right) - taskCreatedAt(left))[0] || null;
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
