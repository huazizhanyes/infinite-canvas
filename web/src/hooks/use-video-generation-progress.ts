import { useEffect, useState } from "react";

import { calculateEstimatedVideoProgress } from "@/lib/video-generation-progress";

export function useVideoGenerationProgress(startedAt?: number, estimateMs?: number, active = true) {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!active || !Number.isFinite(startedAt) || !Number.isFinite(estimateMs) || Number(estimateMs) <= 0) return;
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [active, estimateMs, startedAt]);

    if (!active) return 0;
    if (!Number.isFinite(startedAt) || !Number.isFinite(estimateMs) || Number(estimateMs) <= 0) return null;
    return calculateEstimatedVideoProgress(startedAt, estimateMs, now);
}
