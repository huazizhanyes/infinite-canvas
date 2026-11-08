import { create } from "zustand";
import { useUserStore } from "@/stores/use-user-store";
import { getCanvasSessionEpoch, subscribeCanvasAccountScope } from "@/lib/canvas-account-scope";
import { fetchCanvasTasks, type CanvasServerTask } from "@/services/api/canvas-tasks";
type TaskState = { active: CanvasServerTask[]; total: number; loading: boolean; stale: boolean; error: string; updatedAt: string | null };
const initial: TaskState = { active: [], total: 0, loading: false, stale: true, error: "", updatedAt: null };
export const useCanvasServerTaskStore = create<TaskState>(() => ({ ...initial }));
let owners = 0, failures = 0, token = "";
let timer: ReturnType<typeof setTimeout> | null = null;
let flight: Promise<void> | null = null;
let controller: AbortController | null = null;
let stopUser: (() => void) | null = null, stopScope: (() => void) | null = null;
function schedule() {
    if (timer) clearTimeout(timer);
    if (!owners) return;
    const active = useCanvasServerTaskStore.getState().total > 0;
    timer = setTimeout(() => { timer = null; void refreshCanvasServerTasks(); }, Math.min(60000, failures ? 5000 * 2 ** failures : active ? 5000 : 20000));
}
export async function refreshCanvasServerTasks() {
    if (flight) return flight;
    const connection = useUserStore.getState().connection;
    if (!connection?.token || !useUserStore.getState().user) return;
    const epoch = getCanvasSessionEpoch(), requestToken = connection.token;
    controller = new AbortController();
    const signal = controller.signal;
    const current = () => !signal.aborted && epoch === getCanvasSessionEpoch() && useUserStore.getState().connection?.token === requestToken;
    const work = async () => {
        useCanvasServerTaskStore.setState({ loading: true });
        try {
            let cursor: string | null = null, total = 0, observedAt = "";
            const tasks = new Map<string, CanvasServerTask>();
            // 完整遍历活动任务，数量不受 30/100 条上限影响。
            do {
                const page = await fetchCanvasTasks(connection, "active", cursor, signal);
                if (!current()) return;
                total = page.total; observedAt = page.observedAt;
                for (const task of page.tasks) tasks.set(`${task.kind}:${task.id}`, task);
                cursor = page.nextCursor;
            } while (cursor);
            if (!current()) return;
            failures = 0;
            useCanvasServerTaskStore.setState({ active: [...tasks.values()], total, stale: false, error: "", updatedAt: observedAt });
        } catch (error) {
            if (current()) { failures++; useCanvasServerTaskStore.setState({ stale: true, error: error instanceof Error ? error.message : "队列暂时无法同步" }); }
        } finally { if (current()) useCanvasServerTaskStore.setState({ loading: false }); }
    };
    const pending = work(); flight = pending;
    try { await pending; } finally { if (flight === pending) { flight = null; schedule(); } }
}
function reset() {
    controller?.abort(); controller = null; flight = null; failures = 0;
    useCanvasServerTaskStore.setState({ ...initial });
    void refreshCanvasServerTasks();
}
function focus() { if (document.visibilityState === "visible") void refreshCanvasServerTasks(); }
export function startCanvasServerTaskPolling() {
    owners++;
    if (owners === 1) {
        token = useUserStore.getState().connection?.token || "";
        stopUser = useUserStore.subscribe(state => { const next = state.connection?.token || ""; if (next !== token) { token = next; reset(); } else if (state.user && !flight && !useCanvasServerTaskStore.getState().updatedAt) void refreshCanvasServerTasks(); });
        stopScope = subscribeCanvasAccountScope(reset);
        window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
        window.addEventListener("canvas-video-balance-changed", focus);
        window.addEventListener("canvas-task-queue-refresh", focus);
        void refreshCanvasServerTasks();
    }
    return () => {
        owners--; if (owners) return;
        if (timer) clearTimeout(timer); controller?.abort(); flight = null;
        stopUser?.(); stopScope?.();
        window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); window.removeEventListener("canvas-video-balance-changed", focus); window.removeEventListener("canvas-task-queue-refresh", focus);
    };
}
