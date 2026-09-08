import { videoCapabilitiesOf, type AiConfig } from "@/stores/use-config-store";

export const DEFAULT_VIDEO_ESTIMATE_MS = 8 * 60 * 1000;

export type VideoProgressBaseline = {
    videoProgressStartedAt: number;
    videoProgressEstimateMs: number;
    videoProgressSampleCount: number;
};

export function createVideoProgressBaseline(config: AiConfig, model = config.videoModel || config.model, startedAt = Date.now()): VideoProgressBaseline {
    const recent = videoCapabilitiesOf(config, model)?.recent3;
    const averageSeconds = Number(recent?.avgDurationSeconds);
    const estimateMs = Number.isFinite(averageSeconds) && averageSeconds > 0 ? averageSeconds * 1000 : DEFAULT_VIDEO_ESTIMATE_MS;
    return {
        videoProgressStartedAt: startedAt,
        videoProgressEstimateMs: estimateMs,
        videoProgressSampleCount: Number.isFinite(Number(recent?.sampleCount)) ? Number(recent?.sampleCount) : 0,
    };
}

export function calculateEstimatedVideoProgress(startedAt: number | undefined, estimateMs: number | undefined, now = Date.now()) {
    if (!Number.isFinite(startedAt) || !Number.isFinite(estimateMs) || Number(estimateMs) <= 0) return 1;
    const elapsedMs = Math.max(0, now - Number(startedAt));
    return Math.max(1, Math.min(99, Math.floor((elapsedMs / Number(estimateMs)) * 100)));
}
