import { useEffect, useRef, useState } from "react";
import { App, Button, Modal, Slider } from "antd";
import { AudioLines, Pause, Play, RotateCcw, Scissors } from "lucide-react";

import { captureVideoAudioSegment, formatAudioClipTime, MAX_AUDIO_EXTRACT_DURATION_MS, MIN_AUDIO_EXTRACT_DURATION_MS, normalizeAudioExtractRange, type CanvasAudioExtractResult } from "@/lib/canvas/canvas-audio-extract";
import { resolvePersistedMediaUrl } from "@/services/file-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type CanvasNodeAudioExtractDialogProps = {
    node: CanvasNodeData | null;
    open: boolean;
    onClose: () => void;
    onConfirm: (result: CanvasAudioExtractResult) => Promise<void> | void;
};

const DEFAULT_RANGE: [number, number] = [0, 0];

export function CanvasNodeAudioExtractDialog({ node, open, onClose, onConfirm }: CanvasNodeAudioExtractDialogProps) {
    const { message } = App.useApp();
    const videoRef = useRef<HTMLVideoElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const previewEndRef = useRef<number | null>(null);
    const [sourceUrl, setSourceUrl] = useState("");
    const [sourceLoading, setSourceLoading] = useState(false);
    const [sourceError, setSourceError] = useState("");
    const [durationMs, setDurationMs] = useState(0);
    const [range, setRange] = useState<[number, number]>(DEFAULT_RANGE);
    const [previewing, setPreviewing] = useState(false);
    const [previewTimeMs, setPreviewTimeMs] = useState(0);
    const [extracting, setExtracting] = useState(false);
    const [progressMs, setProgressMs] = useState(0);

    useEffect(() => {
        if (!open || !node || node.type !== CanvasNodeType.Video) return;
        let cancelled = false;
        abortRef.current?.abort();
        abortRef.current = null;
        videoRef.current?.pause();
        setSourceUrl("");
        setSourceLoading(true);
        setSourceError("");
        setDurationMs(0);
        setRange(DEFAULT_RANGE);
        setPreviewing(false);
        setPreviewTimeMs(0);
        setProgressMs(0);

        void resolvePersistedMediaUrl(node.metadata?.mediaId, node.metadata?.storageKey, node.metadata?.content || "")
            .then((url) => {
                if (cancelled) return;
                if (!url) {
                    setSourceError("视频地址不可用，请重新上传后再试");
                    setSourceLoading(false);
                    return;
                }
                setSourceUrl(url);
            })
            .catch((error) => {
                if (cancelled) return;
                setSourceError(error instanceof Error ? error.message : "视频加载失败");
                setSourceLoading(false);
            });

        return () => {
            cancelled = true;
            abortRef.current?.abort();
            previewEndRef.current = null;
            videoRef.current?.pause();
        };
    }, [node?.id, open]);

    if (!node || node.type !== CanvasNodeType.Video) return null;

    const stopPreview = () => {
        previewEndRef.current = null;
        videoRef.current?.pause();
        setPreviewing(false);
        setPreviewTimeMs(0);
    };

    const updateRange = (values: number | number[]) => {
        if (!durationMs) return;
        const next = Array.isArray(values) ? values : [values, values];
        const normalized = normalizeAudioExtractRange({ startMs: next[0], endMs: next[1] }, durationMs);
        stopPreview();
        setRange([normalized.startMs, normalized.endMs]);
    };

    const setStartFromPlayhead = () => {
        const video = videoRef.current;
        if (!video || !durationMs) return;
        const startMs = Math.max(0, Math.min(Math.round(video.currentTime * 1000), durationMs - MIN_AUDIO_EXTRACT_DURATION_MS));
        let endMs = Math.max(range[1], startMs + MIN_AUDIO_EXTRACT_DURATION_MS);
        if (endMs - startMs > MAX_AUDIO_EXTRACT_DURATION_MS) endMs = startMs + MAX_AUDIO_EXTRACT_DURATION_MS;
        const normalized = normalizeAudioExtractRange({ startMs, endMs }, durationMs);
        stopPreview();
        setRange([normalized.startMs, normalized.endMs]);
    };

    const setEndFromPlayhead = () => {
        const video = videoRef.current;
        if (!video || !durationMs) return;
        const endMs = Math.max(MIN_AUDIO_EXTRACT_DURATION_MS, Math.min(Math.round(video.currentTime * 1000), durationMs));
        let startMs = Math.min(range[0], endMs - MIN_AUDIO_EXTRACT_DURATION_MS);
        if (endMs - startMs > MAX_AUDIO_EXTRACT_DURATION_MS) startMs = endMs - MAX_AUDIO_EXTRACT_DURATION_MS;
        const normalized = normalizeAudioExtractRange({ startMs, endMs }, durationMs);
        stopPreview();
        setRange([normalized.startMs, normalized.endMs]);
    };

    const togglePreview = async () => {
        const video = videoRef.current;
        if (!video || !durationMs) return;
        if (previewing) {
            stopPreview();
            return;
        }
        video.currentTime = range[0] / 1000;
        previewEndRef.current = range[1];
        video.muted = false;
        video.volume = 1;
        setPreviewTimeMs(0);
        try {
            await video.play();
            setPreviewing(true);
        } catch {
            previewEndRef.current = null;
            message.error("无法播放视频片段，请重试");
        }
    };

    const handleTimeUpdate = () => {
        const video = videoRef.current;
        if (!video || previewEndRef.current === null) return;
        setPreviewTimeMs(Math.max(0, Math.min(video.currentTime * 1000 - range[0], previewEndRef.current - range[0])));
        if (video.currentTime * 1000 >= previewEndRef.current - 20) stopPreview();
    };

    const handleLoadedMetadata = () => {
        const video = videoRef.current;
        if (!video) return;
        const detectedDuration = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : Math.round(node.metadata?.durationMs || 0);
        if (detectedDuration <= 0) {
            setSourceError("无法读取视频时长，请重新上传后再试");
            setSourceLoading(false);
            return;
        }
        const endMs = Math.min(detectedDuration, MAX_AUDIO_EXTRACT_DURATION_MS);
        setDurationMs(detectedDuration);
        setRange([0, endMs]);
        setSourceLoading(false);
    };

    const handleConfirm = async () => {
        const video = videoRef.current;
        if (!video || !durationMs || extracting) return;
        stopPreview();
        const controller = new AbortController();
        abortRef.current = controller;
        setExtracting(true);
        setProgressMs(0);
        try {
            const result = await captureVideoAudioSegment(video, { startMs: range[0], endMs: range[1] }, { signal: controller.signal, onProgress: setProgressMs });
            setProgressMs(result.durationMs);
            await onConfirm(result);
        } catch (error) {
            if (!(error instanceof DOMException && error.name === "AbortError")) message.error(error instanceof Error ? error.message : "音频分离失败，请重试");
        } finally {
            abortRef.current = null;
            setExtracting(false);
        }
    };

    const handleClose = () => {
        if (extracting) return;
        stopPreview();
        onClose();
    };

    const resetRange = () => {
        stopPreview();
        setRange([0, Math.min(durationMs, MAX_AUDIO_EXTRACT_DURATION_MS)]);
    };

    const selectedDurationMs = Math.max(0, range[1] - range[0]);

    return (
        <Modal
            title={
                <span className="inline-flex items-center gap-2">
                    <Scissors className="size-4" />
                    裁剪并分离音频
                </span>
            }
            open={open}
            width={820}
            centered
            destroyOnHidden
            maskClosable={!extracting}
            keyboard={!extracting}
            onCancel={handleClose}
            footer={
                <div className="flex items-center justify-end gap-2">
                    <Button icon={<RotateCcw className="size-4" />} disabled={!durationMs || extracting} onClick={resetRange}>
                        重置选区
                    </Button>
                    <Button disabled={extracting} onClick={handleClose}>
                        取消
                    </Button>
                    <Button type="primary" icon={<Scissors className="size-4" />} loading={extracting} disabled={!durationMs || selectedDurationMs < MIN_AUDIO_EXTRACT_DURATION_MS} onClick={() => void handleConfirm()}>
                        分离并生成节点
                    </Button>
                </div>
            }
        >
            <div className="space-y-4">
                {sourceLoading && !sourceUrl ? <div className="grid min-h-64 place-items-center text-sm opacity-65">视频加载中…</div> : null}
                {!sourceLoading && sourceError ? <div className="grid min-h-64 place-items-center rounded-lg border border-red-300/60 p-6 text-center text-sm text-red-500">{sourceError}</div> : null}
                {!sourceError && sourceUrl ? (
                    <>
                        <div className="relative">
                            <video
                                ref={videoRef}
                                src={sourceUrl}
                                crossOrigin={sourceUrl.startsWith("blob:") || sourceUrl.startsWith("data:") ? undefined : "anonymous"}
                                controls={!extracting && !sourceLoading}
                                playsInline
                                preload="metadata"
                                className="max-h-[420px] w-full rounded-lg bg-black object-contain"
                                onLoadedMetadata={handleLoadedMetadata}
                                onLoadedData={() => setSourceLoading(false)}
                                onTimeUpdate={handleTimeUpdate}
                                onPlay={() => {
                                    if (previewEndRef.current !== null) setPreviewing(true);
                                }}
                                onPause={() => {
                                    if (previewEndRef.current !== null) stopPreview();
                                }}
                                onEnded={() => stopPreview()}
                                onError={() => {
                                    setSourceError("视频加载失败，请重新上传后再试");
                                    setSourceLoading(false);
                                }}
                            />
                            {sourceLoading ? <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-lg bg-black/55 text-sm text-white">视频加载中…</div> : null}
                        </div>

                        <div className="rounded-xl border p-4 transition-opacity" style={{ borderColor: "rgba(127,127,127,.25)", opacity: sourceLoading ? 0.5 : 1, pointerEvents: sourceLoading ? "none" : undefined }}>
                            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                <span className="inline-flex items-center gap-2 font-medium">
                                    <AudioLines className="size-4" />
                                    选择要提取的音频片段
                                </span>
                                <span className="opacity-65">最长 {MAX_AUDIO_EXTRACT_DURATION_MS / 1000} 秒</span>
                            </div>
                            <Slider className="mt-4" range min={0} max={durationMs} step={100} value={range} disabled={extracting} tooltip={{ formatter: (value) => formatAudioClipTime(Number(value || 0)) }} onChange={updateRange} />
                            <div className="grid grid-cols-3 gap-3 text-sm">
                                <div>
                                    <div className="text-xs opacity-55">开始</div>
                                    <div className="mt-1 font-medium tabular-nums">{formatAudioClipTime(range[0])}</div>
                                </div>
                                <div>
                                    <div className="text-xs opacity-55">结束</div>
                                    <div className="mt-1 font-medium tabular-nums">{formatAudioClipTime(range[1])}</div>
                                </div>
                                <div>
                                    <div className="text-xs opacity-55">片段时长</div>
                                    <div className="mt-1 font-medium tabular-nums">{formatAudioClipTime(selectedDurationMs)}</div>
                                </div>
                            </div>
                            <div className="mt-4 flex flex-wrap items-center gap-2">
                                <Button size="small" icon={previewing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} disabled={extracting} onClick={() => void togglePreview()}>
                                    {previewing ? "停止试听" : "试听选区"}
                                </Button>
                                <Button size="small" disabled={extracting} onClick={setStartFromPlayhead}>
                                    设为起点
                                </Button>
                                <Button size="small" disabled={extracting} onClick={setEndFromPlayhead}>
                                    设为终点
                                </Button>
                            </div>
                            {previewing ? (
                                <div className="mt-3 flex items-center gap-2 text-xs opacity-75">
                                    <span className="shrink-0">正在试听</span>
                                    <div className="h-1 min-w-16 flex-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                                        <div className="h-full rounded-full bg-[#a855f7] transition-[width] duration-100" style={{ width: `${selectedDurationMs ? (previewTimeMs / selectedDurationMs) * 100 : 0}%` }} />
                                    </div>
                                    <span className="shrink-0 tabular-nums">{formatAudioClipTime(previewTimeMs)} / {formatAudioClipTime(selectedDurationMs)}</span>
                                </div>
                            ) : null}
                        </div>

                        {extracting ? (
                            <div className="rounded-lg bg-black/5 px-4 py-3 text-sm dark:bg-white/5">
                                正在提取音频 {formatAudioClipTime(progressMs)} / {formatAudioClipTime(selectedDurationMs)}
                            </div>
                        ) : (
                            <div className="text-xs leading-5 opacity-55">提取时会播放选中片段，完成后会在视频右侧生成一个新的音频节点。</div>
                        )}
                    </>
                ) : null}
            </div>
        </Modal>
    );
}
