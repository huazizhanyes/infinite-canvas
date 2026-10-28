import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Modal, Slider } from "antd";
import { Eraser, Pencil, RotateCcw, Undo2, X } from "lucide-react";

import { compositeDoodleDataUrl } from "@/lib/canvas/canvas-image-data";
import { readImageMeta } from "@/lib/image-utils";

export type CanvasImageDoodlePayload = {
    doodleDataUrl: string;
};

type DrawMode = "paint" | "erase";

type DoodlePoint = { x: number; y: number };

type DoodleStroke = {
    mode: DrawMode;
    color: string;
    size: number;
    points: DoodlePoint[];
};

const defaultBrushSize = 6;
const defaultDoodleColor = "#ef4444";
const doodleColors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#111827", "#ffffff"];
const maxBrushSize = 40;

export function CanvasNodeDoodleDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (payload: CanvasImageDoodlePayload) => void | Promise<void> }) {
    const strokeCanvasRef = useRef<HTMLCanvasElement>(null);
    const strokesRef = useRef<DoodleStroke[]>([]);
    const drawingRef = useRef<{ active: boolean; stroke: DoodleStroke | null }>({ active: false, stroke: null });
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [brushSize, setBrushSize] = useState(defaultBrushSize);
    const [color, setColor] = useState(defaultDoodleColor);
    const [mode, setMode] = useState<DrawMode>("paint");
    const [strokeCount, setStrokeCount] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!open) return;
        strokesRef.current = [];
        drawingRef.current = { active: false, stroke: null };
        setBrushSize(defaultBrushSize);
        setColor(defaultDoodleColor);
        setMode("paint");
        setStrokeCount(0);
        setSubmitting(false);
        setError("");
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, open]);

    useEffect(() => {
        redrawStrokes();
    }, [image]);

    const redrawStrokes = () => {
        const canvas = strokeCanvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        for (const stroke of strokesRef.current) {
            drawStroke(context, stroke);
        }
        setStrokeCount(strokesRef.current.length);
    };

    const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const point = readCanvasPoint(event.currentTarget, event.clientX, event.clientY);
        const canvas = strokeCanvasRef.current;
        const context = canvas?.getContext("2d");
        const stroke = drawingRef.current.stroke;
        if (!canvas || !context || !stroke) return;
        if (!stroke.points.length) {
            stroke.points.push(point);
            drawStroke(context, stroke);
        } else {
            const last = stroke.points[stroke.points.length - 1];
            stroke.points.push(point);
            drawStrokeSegment(context, stroke, last, point);
        }
    };

    const startDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        drawingRef.current = { active: true, stroke: { mode, color, size: brushSize, points: [] } };
        draw(event);
    };

    const moveDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (!drawingRef.current.active) return;
        event.preventDefault();
        draw(event);
    };

    const stopDraw = () => {
        const stroke = drawingRef.current.stroke;
        if (drawingRef.current.active && stroke && stroke.points.length) {
            strokesRef.current.push(stroke);
            setStrokeCount(strokesRef.current.length);
            setError("");
        }
        drawingRef.current = { active: false, stroke: null };
    };

    const undoStroke = () => {
        if (drawingRef.current.active) return;
        strokesRef.current.pop();
        redrawStrokes();
    };

    const resetStrokes = () => {
        strokesRef.current = [];
        redrawStrokes();
        setError("");
    };

    const submit = async () => {
        const canvas = strokeCanvasRef.current;
        if (!canvas) return;
        if (!strokesRef.current.length) return setError("请先在图片上绘制标记");
        setSubmitting(true);
        setError("");
        try {
            const doodleDataUrl = await compositeDoodleDataUrl(dataUrl, canvas);
            // 等待父级完成上传并创建副本节点，期间保持 loading，避免用户以为卡住。
            await onConfirm({ doodleDataUrl });
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "涂鸦副本生成失败，请重试");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={1100} centered destroyOnHidden>
            <div className="grid gap-5 lg:grid-cols-[minmax(420px,1fr)_320px]">
                <div className="flex items-center justify-center rounded-xl border border-black/10 bg-transparent p-0 dark:border-white/10">
                    <div className="relative inline-block max-w-full overflow-hidden rounded-lg bg-transparent select-none">
                        <img src={dataUrl} alt="" className="block max-h-[calc(100vh-280px)] max-w-full bg-transparent object-contain" draggable={false} />
                        {image ? (
                            <canvas
                                ref={strokeCanvasRef}
                                width={image.width}
                                height={image.height}
                                className={`absolute inset-0 h-full w-full touch-none ${mode === "paint" ? "cursor-crosshair" : "cursor-pointer"}`}
                                onPointerDown={startDraw}
                                onPointerMove={moveDraw}
                                onPointerUp={stopDraw}
                                onPointerCancel={stopDraw}
                            />
                        ) : null}
                    </div>
                </div>

                <div className="flex flex-col gap-4">
                    <div>
                        <h2 className="text-xl font-semibold">图片涂鸦标注</h2>
                        <div className="mt-1.5 text-sm opacity-60">{image ? `${image.width} x ${image.height}px · 标记将生成副本，不影响原图` : "读取中"}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <Button type={mode === "paint" ? "primary" : "default"} icon={<Pencil className="size-4" />} onClick={() => setMode("paint")}>
                            画笔
                        </Button>
                        <Button type={mode === "erase" ? "primary" : "default"} icon={<Eraser className="size-4" />} onClick={() => setMode("erase")}>
                            擦除
                        </Button>
                    </div>

                    <div className="space-y-2">
                        <div className="text-sm font-medium opacity-75">标记颜色</div>
                        <div className="flex items-center gap-2">
                            {doodleColors.map((item) => (
                                <button
                                    key={item}
                                    type="button"
                                    aria-label={`选择颜色 ${item}`}
                                    className={`size-7 rounded-full border transition ${color === item ? "ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-[#1c1c1c]" : ""}`}
                                    style={{ background: item, borderColor: item === "#ffffff" ? "rgba(0,0,0,.15)" : item }}
                                    onClick={() => {
                                        setColor(item);
                                        setMode("paint");
                                    }}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="font-medium opacity-75">画笔粗细</span>
                            <span className="font-semibold">{brushSize}px</span>
                        </div>
                        <Slider min={2} max={maxBrushSize} step={1} value={brushSize} onChange={setBrushSize} />
                    </div>

                    {error ? <div className="text-xs font-medium text-[#ef4444]">{error}</div> : null}

                    <div className="mt-auto flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <Button icon={<Undo2 className="size-4" />} disabled={!strokeCount || submitting} onClick={undoStroke}>
                                撤销
                            </Button>
                            <Button icon={<RotateCcw className="size-4" />} disabled={!strokeCount || submitting} onClick={resetStrokes}>
                                清空
                            </Button>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button icon={<X className="size-4" />} disabled={submitting} onClick={onClose}>
                                取消
                            </Button>
                            <Button type="primary" loading={submitting} onClick={() => void submit()}>
                                {submitting ? "生成中..." : "生成副本"}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function readCanvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
        y: ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
    };
}

function applyStrokeStyle(context: CanvasRenderingContext2D, stroke: DoodleStroke) {
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = stroke.size;
    context.globalCompositeOperation = stroke.mode === "paint" ? "source-over" : "destination-out";
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
}

function drawStroke(context: CanvasRenderingContext2D, stroke: DoodleStroke) {
    applyStrokeStyle(context, stroke);
    const [first, ...rest] = stroke.points;
    if (!first) return;
    if (!rest.length) {
        context.beginPath();
        context.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2);
        context.fill();
        return;
    }
    context.beginPath();
    context.moveTo(first.x, first.y);
    for (const point of rest) context.lineTo(point.x, point.y);
    context.stroke();
}

function drawStrokeSegment(context: CanvasRenderingContext2D, stroke: DoodleStroke, from: DoodlePoint, to: DoodlePoint) {
    applyStrokeStyle(context, stroke);
    if (from.x === to.x && from.y === to.y) {
        context.beginPath();
        context.arc(to.x, to.y, stroke.size / 2, 0, Math.PI * 2);
        context.fill();
        return;
    }
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
}
