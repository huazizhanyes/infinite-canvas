import { flushCanvasPersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { drainSucaiCanvasSync } from "@/services/sucai-canvas-sync";

let active: { id: string; commit: () => void } | null = null;
export function registerActiveCanvasPersistence(id: string, commit: () => void) {
    const entry = active = { id, commit };
    return () => { if (active === entry) active = null; };
}

export async function flushActiveCanvasPersistence() {
    const entry = active;
    entry?.commit();
    await flushCanvasPersistence();
    const drain = async () => {
        for (let pass = 0; pass < 8; pass++) {
            const revision = useCanvasStore.getState().projects.find(project => project.id === entry?.id)?.localRevision;
            const synced = await drainSucaiCanvasSync(entry?.id);
            // 等待请求时仍可能发生编辑，退出前再核对一次最新页面快照。
            if (active === entry) entry?.commit();
            await flushCanvasPersistence();
            const latest = useCanvasStore.getState().projects.find(project => project.id === entry?.id);
            if (!synced || !latest?.localDirty || latest.localRevision === revision) return synced;
        }
        return false;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 网络断开时不让退出一直等到 HTTP 超时；后台重试继续使用已落盘的请求。
    const synced = await Promise.race([
        drain(),
        new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 5000); }),
    ]).finally(() => clearTimeout(timer));
    // 云端版本确认也要写回本地，防止重新进入时恢复旧版本。
    await flushCanvasPersistence();
    return synced;
}
