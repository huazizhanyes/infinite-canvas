import { useEffect, useRef } from "react";
import { App } from "antd";

const VERSION_URL = "/version.json";
const CHECK_INTERVAL_MS = 60 * 1000;
const POSTPONE_MS = 30 * 60 * 1000;
const POSTPONE_KEY = "infinite-canvas:update-postpone";

export type AppVersionProbe = { buildId: string; missing: boolean };
export type UpdateDecision = "baseline" | "prompt" | "skip";

export function normalizeBuildId(value: unknown) {
    return String(value ?? "").trim();
}

/** 读取同源 version.json；404 代表这套部署没有版本文件，需要停止轮询。 */
export async function probeAppVersion(): Promise<AppVersionProbe> {
    try {
        const response = await fetch(`${VERSION_URL}?_t=${Date.now()}`, { cache: "no-store" });
        if (response.status === 404) return { buildId: "", missing: true };
        if (!response.ok) return { buildId: "", missing: false };
        const payload = (await response.json()) as { version?: string; buildId?: string };
        return { buildId: normalizeBuildId(payload?.buildId || payload?.version), missing: false };
    } catch {
        return { buildId: "", missing: false };
    }
}

/**
 * 以“打开页面时拿到的 buildId”为基线判断是否发布了新版本。
 * 子应用自己的构建号和主站不同，不能拿来自比，否则会一直误报。
 */
export function decideUpdateAction(input: { baseline: string; latest: string; postponed?: { buildId: string; at: number } | null; now: number }): UpdateDecision {
    if (!input.latest) return "skip";
    if (!input.baseline) return "baseline";
    if (input.latest === input.baseline) return "skip";
    if (input.postponed && input.postponed.buildId === input.latest && input.now - input.postponed.at < POSTPONE_MS) return "skip";
    return "prompt";
}

export function readPostponeRecord(): { buildId: string; at: number } | null {
    try {
        const raw = window.sessionStorage.getItem(POSTPONE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { buildId?: unknown; at?: unknown };
        const buildId = normalizeBuildId(parsed?.buildId);
        const at = Number(parsed?.at);
        return buildId && Number.isFinite(at) ? { buildId, at } : null;
    } catch {
        return null;
    }
}

export function writePostponeRecord(buildId: string, at = Date.now()) {
    try {
        window.sessionStorage.setItem(POSTPONE_KEY, JSON.stringify({ buildId, at }));
    } catch {
        // 隐私模式下不写存储，只影响提示频率。
    }
}

/**
 * 全局新版本提示：轮询同源 version.json，发现构建号变化就提示更新。
 * 用户可以选择“稍后”，此时同一构建号会在限定时间内不再打扰。
 */
export function useAppUpdateCheck() {
    const { modal } = App.useApp();
    const baselineRef = useRef("");
    const promptingRef = useRef(false);

    useEffect(() => {
        let cancelled = false;
        let timer: number | undefined;
        const stopPolling = () => {
            if (timer) {
                window.clearInterval(timer);
                timer = undefined;
            }
        };

        const check = async () => {
            if (cancelled || promptingRef.current) return;
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            const probe = await probeAppVersion();
            if (cancelled) return;
            if (probe.missing) {
                stopPolling();
                return;
            }
            const action = decideUpdateAction({
                baseline: baselineRef.current,
                latest: probe.buildId,
                postponed: readPostponeRecord(),
                now: Date.now(),
            });
            if (action === "skip") return;
            if (action === "baseline") {
                baselineRef.current = probe.buildId;
                return;
            }

            promptingRef.current = true;
            const release = () => {
                promptingRef.current = false;
            };
            modal.confirm({
                title: "发现新版本",
                content: "有新的版本已发布，更新会刷新当前页面；如果你正在编辑，可以先选择“稍后”。",
                okText: "立即更新",
                cancelText: "稍后",
                centered: true,
                onOk: () => {
                    window.location.reload();
                },
                onCancel: () => {
                    writePostponeRecord(probe.buildId);
                    release();
                },
                afterClose: release,
            });
        };

        const handleVisible = () => {
            if (document.visibilityState !== "hidden") void check();
        };

        void check();
        timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
        window.addEventListener("focus", handleVisible);
        document.addEventListener("visibilitychange", handleVisible);
        return () => {
            cancelled = true;
            stopPolling();
            window.removeEventListener("focus", handleVisible);
            document.removeEventListener("visibilitychange", handleVisible);
        };
    }, [modal]);
}
