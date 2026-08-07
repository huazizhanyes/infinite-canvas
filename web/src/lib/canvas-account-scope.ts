import type { StateStorage } from "zustand/middleware";
import { localForageStorage } from "@/lib/localforage-storage";

export type CanvasAccountScope = {
    userId: string;
    sessionEpoch: number;
};

const LEGACY_MIGRATION_KEY = "infinite-canvas:account-migration:v1";
let scope: CanvasAccountScope | null = null;
let epoch = 0;
const listeners = new Set<(next: CanvasAccountScope | null) => void>();

export function getCanvasAccountScope() {
    return scope;
}

export function getCanvasStorageScopeId() {
    return scope?.userId || "guest";
}

export function getCanvasSessionEpoch() {
    return epoch;
}

export function setCanvasAccountScope(userId: string | number | null) {
    const nextUserId = String(userId ?? "").trim();
    if (!nextUserId) return clearCanvasAccountScope();
    if (scope?.userId === nextUserId) return scope;
    epoch += 1;
    scope = { userId: nextUserId, sessionEpoch: epoch };
    listeners.forEach((listener) => listener(scope));
    return scope;
}

export function clearCanvasAccountScope() {
    if (!scope) return;
    epoch += 1;
    scope = null;
    listeners.forEach((listener) => listener(null));
}

export function subscribeCanvasAccountScope(listener: (next: CanvasAccountScope | null) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function accountScopedKey(baseKey: string, userId = getCanvasStorageScopeId()) {
    return `${baseKey}:u:${encodeURIComponent(userId)}`;
}

export function accountScopedStorage(baseStorage: StateStorage): StateStorage {
    return {
        getItem: (name) => baseStorage.getItem(accountScopedKey(name)),
        setItem: (name, value) => {
            if (!scope) return;
            return baseStorage.setItem(accountScopedKey(name), value);
        },
        removeItem: (name) => baseStorage.removeItem(accountScopedKey(name)),
    };
}

export function getLegacyMigrationKey() {
    return LEGACY_MIGRATION_KEY;
}

export function getLegacyMigrationRecord(): { boundUserId: string; completedAt: string } | null {
    try {
        const raw = window.localStorage.getItem(LEGACY_MIGRATION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<{ boundUserId: string; completedAt: string }>;
        return typeof parsed.boundUserId === "string" && typeof parsed.completedAt === "string"
            ? { boundUserId: parsed.boundUserId, completedAt: parsed.completedAt }
            : null;
    } catch {
        return null;
    }
}

export function setLegacyMigrationRecord(boundUserId: string) {
    try {
        window.localStorage.setItem(LEGACY_MIGRATION_KEY, JSON.stringify({ boundUserId, completedAt: new Date().toISOString() }));
    } catch {
        // Storage failures must not block the authenticated session.
    }
}

export async function migrateLegacyCanvasData(userId: string) {
    if (typeof window === "undefined" || getLegacyMigrationRecord()) return false;
    const lockKey = `${LEGACY_MIGRATION_KEY}:lock`;
    if (window.localStorage.getItem(lockKey)) return false;
    window.localStorage.setItem(lockKey, userId);
    try {
        const [{ migrateLegacyImageStorage }, { migrateLegacyMediaStorage }] = await Promise.all([
            import("@/services/image-storage"),
            import("@/services/file-storage"),
        ]);
        const [imageMap, mediaMap] = await Promise.all([migrateLegacyImageStorage(userId), migrateLegacyMediaStorage(userId)]);
        for (const base of ["infinite-canvas:canvas_store", "infinite-canvas:asset_store", "infinite-canvas:desktop-task-snapshots", "infinite-canvas:image-generation-logs", "infinite-canvas:video-generation-logs", "infinite-canvas:ai_config_store"]) {
            const raw = await localForageStorage.getItem(base);
            if (!raw) continue;
            const rewritten = rewriteLegacyStorage(JSON.parse(raw), imageMap, mediaMap);
            await localForageStorage.setItem(accountScopedKey(base, userId), JSON.stringify(rewritten));
        }
        setLegacyMigrationRecord(userId);
        return true;
    } finally {
        window.localStorage.removeItem(lockKey);
    }
}

function rewriteLegacyStorage(value: unknown, imageMap: Map<string, string>, mediaMap: Map<string, string>): unknown {
    if (typeof value === "string") return imageMap.get(value) || mediaMap.get(value) || value;
    if (Array.isArray(value)) return value.map((item) => rewriteLegacyStorage(item, imageMap, mediaMap));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteLegacyStorage(item, imageMap, mediaMap)]));
}
