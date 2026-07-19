import { useMemo, useState } from "react";
import { Check, Edit3, Image as ImageIcon, LoaderCircle, Play, RefreshCw, WandSparkles } from "lucide-react";

import type { StoryboardGridShot } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

const statusLabel: Record<string, string> = { idle: "待规划", planning: "规划中", draft: "待确认", generating: "生成中", partial: "部分完成", complete: "已完成", error: "出错" };

export function CanvasStoryboardGridNode({ ctx }: { ctx: CanvasNodeContext }) {
    const metadata = ctx.node.metadata || {};
    const plan = metadata.storyboardGridPlan;
    const shots = plan?.shots || [];
    const [activeSlot, setActiveSlot] = useState(1);
    const source = useMemo(() => {
        const sourceNode = metadata.sourceNodeId ? ctx.getNode(metadata.sourceNodeId) : ctx.getUpstream().find((node) => node.type === "text");
        return { node: sourceNode, text: metadata.storyboardGridSourceSnapshot || sourceNode?.metadata?.content || sourceNode?.metadata?.prompt || "" };
    }, [ctx, metadata.sourceNodeId, metadata.storyboardGridSourceSnapshot]);
    const active = shots.find((shot) => shot.slot === activeSlot) || shots[0];
    const generated = shots.filter((shot) => Boolean(shot.imageNodeId && ctx.getNode(shot.imageNodeId)?.metadata?.content)).length;
    const planning = metadata.storyboardGridStatus === "planning";
    const generating = metadata.storyboardGridStatus === "generating";
    const emit = (event: string, payload?: unknown) => ctx.emit(event, { gridNodeId: ctx.node.id, ...((payload || {}) as object) });
    const updateShot = (patch: Partial<StoryboardGridShot>) => {
        if (!active || !plan) return;
        ctx.updateMetadata({ storyboardGridPlan: { ...plan, shots: shots.map((shot) => (shot.id === active.id ? { ...shot, ...patch } : shot)) } });
    };

    return (
        <div data-canvas-no-zoom className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[inherit]" style={{ background: ctx.theme.node.panel, color: ctx.theme.node.text }} onWheel={(event) => event.stopPropagation()}>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2" style={{ borderColor: ctx.theme.node.stroke }}>
                <div className="flex min-w-0 items-center gap-2">
                    <WandSparkles className="size-4 text-violet-400" />
                    <span className="truncate text-sm font-semibold">{plan?.title || "九宫格分镜"}</span>
                    <span className="text-[11px] opacity-60">{statusLabel[metadata.storyboardGridStatus || "idle"]}</span>
                </div>
                <span className="text-xs opacity-60">{generated}/9 已生成</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 lg:flex-row">
                <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center justify-between text-[11px] opacity-65">
                        <span>九宫格镜头</span>
                        <span>{metadata.storyboardGridAspectRatio || "16:9"}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        {Array.from({ length: 9 }, (_, index) => {
                            const shot = shots[index];
                            const image = shot?.imageNodeId ? ctx.getNode(shot.imageNodeId) : null;
                            const done = Boolean(image?.metadata?.content);
                            const loading = image?.metadata?.status === "loading";
                            const failed = image?.metadata?.status === "error";
                            return (
                                <button
                                    key={shot?.id || index}
                                    type="button"
                                    className={`relative min-w-0 overflow-hidden rounded-lg border text-left ${activeSlot === index + 1 ? "ring-2 ring-violet-400" : ""}`}
                                    style={{ borderColor: ctx.theme.node.stroke, aspectRatio: "16 / 9", background: ctx.theme.node.fill }}
                                    onClick={() => setActiveSlot(index + 1)}
                                >
                                    {image?.metadata?.content ? (
                                        <img src={image.metadata.content} className="h-full w-full object-cover" />
                                    ) : (
                                        <div className="grid h-full place-items-center text-[11px] opacity-45">
                                            {loading ? <LoaderCircle className="size-4 animate-spin" /> : failed ? <span className="text-red-300">失败</span> : <span>{index + 1}</span>}
                                        </div>
                                    )}
                                    <div className="absolute inset-x-1 bottom-1 rounded bg-black/65 px-1.5 py-1 text-[10px] leading-tight text-white">
                                        <div className="truncate font-medium">{shot?.title || `镜头 ${index + 1}`}</div>
                                        {shot?.visualDescription ? <div className="mt-0.5 line-clamp-2 opacity-80">{shot.visualDescription}</div> : null}
                                    </div>
                                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{index + 1}</span>
                                    {done ? <Check className="absolute right-1 top-1 size-3 text-emerald-300" /> : null}
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 border-t pt-3 lg:border-l lg:border-t-0 lg:pl-3" style={{ borderColor: ctx.theme.node.stroke }}>
                    <div className="flex flex-wrap gap-2">
                        <select
                            className="rounded-md border bg-transparent px-2 py-1 text-xs"
                            value={metadata.storyboardGridAspectRatio || "16:9"}
                            disabled={planning || generating}
                            onChange={(event) => ctx.updateMetadata({ storyboardGridAspectRatio: event.target.value as "16:9" | "9:16" | "1:1" })}
                        >
                            <option value="16:9">16:9</option>
                            <option value="9:16">9:16</option>
                            <option value="1:1">1:1</option>
                        </select>
                        <input
                            className="min-w-[120px] flex-1 rounded-md border bg-transparent px-2 py-1 text-xs"
                            value={metadata.storyboardGridVisualStyle || ""}
                            disabled={planning || generating}
                            onChange={(event) => ctx.updateMetadata({ storyboardGridVisualStyle: event.target.value })}
                            placeholder="统一视觉设定"
                        />
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md bg-violet-500 px-2 py-1 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={planning || generating}
                            onClick={() => emit("canvas-storyboard-grid-plan", { sourceNodeId: source.node?.id, content: source.text })}
                        >
                            <WandSparkles className="size-3" />
                            {planning ? "规划中..." : plan ? "重新规划" : "AI 规划 9 镜头"}
                        </button>
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={planning || generating || !shots.length}
                            onClick={() => emit("canvas-storyboard-grid-generate", { shotIds: shots.filter((shot) => !shot.imageNodeId || !ctx.getNode(shot.imageNodeId)?.metadata?.content).map((shot) => shot.id) })}
                        >
                            <Play className="size-3" />
                            {generating ? "生成中..." : "生成缺失"}
                        </button>
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={planning || generating || !shots.length}
                            onClick={() => {
                                if (window.confirm("确定要重绘全部 9 个镜头吗？")) emit("canvas-storyboard-grid-generate", { shotIds: shots.map((shot) => shot.id), replaceAll: true });
                            }}
                        >
                            <RefreshCw className="size-3" />
                            全部重绘
                        </button>
                    </div>
                    {active ? (
                        <>
                            <input className="rounded-md border bg-transparent px-2 py-1 text-xs" value={active.title} disabled={planning || generating} onChange={(event) => updateShot({ title: event.target.value })} />
                            <textarea
                                className="min-h-[72px] flex-1 resize-none rounded-md border bg-transparent p-2 text-xs"
                                value={active.imagePrompt}
                                disabled={planning || generating}
                                onChange={(event) => updateShot({ imagePrompt: event.target.value })}
                            />
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <input className="rounded-md border bg-transparent px-2 py-1" value={active.shotSize} disabled={planning || generating} onChange={(event) => updateShot({ shotSize: event.target.value })} placeholder="景别" />
                                <input className="rounded-md border bg-transparent px-2 py-1" value={active.cameraAngle} disabled={planning || generating} onChange={(event) => updateShot({ cameraAngle: event.target.value })} placeholder="机位" />
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={planning || generating}
                                    onClick={() => emit("canvas-storyboard-grid-generate", { shotIds: [active.id] })}
                                >
                                    <ImageIcon className="size-3" />
                                    生成此格
                                </button>
                                {active.imageNodeId ? (
                                    <button type="button" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs" onClick={() => emit("canvas-storyboard-grid-open-image", { imageNodeId: active.imageNodeId })}>
                                        <Edit3 className="size-3" />
                                        打开图片节点
                                    </button>
                                ) : null}
                            </div>
                        </>
                    ) : (
                        <div className="grid flex-1 place-items-center text-xs opacity-50">先用 AI 规划九个镜头</div>
                    )}
                </div>
            </div>
        </div>
    );
}
