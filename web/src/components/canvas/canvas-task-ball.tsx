import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AudioLines, ChevronRight, Image, ListVideo, LoaderCircle, RefreshCw, Video, X } from "lucide-react";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasServerTaskStore, startCanvasServerTaskPolling, refreshCanvasServerTasks } from "@/stores/canvas/use-canvas-server-task-store";
import type { CanvasServerTask } from "@/services/api/canvas-tasks";

const statuses: Record<string, string> = { queued: "排队中", pending: "等待中", submitting: "提交中", submission_unknown: "确认提交中，请勿重复发送", in_progress: "生成中", running: "生成中", generating: "生成中", processing: "处理中", charging: "结算中", generated: "结算中", enhancing: "增强中", archiving: "保存成片中" };
const kinds = { video: "视频", image: "图片", audio: "音频", text: "文本" };
function elapsed(task: CanvasServerTask) {
    const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(task.createdAt)) / 1000));
    return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
function TaskIcon({ kind }: { kind: CanvasServerTask["kind"] }) {
    const Icon = kind === "video" ? Video : kind === "image" ? Image : kind === "audio" ? AudioLines : ListVideo;
    return <Icon className="size-4 shrink-0" />;
}

export function CanvasTaskBall() {
    const location = useLocation(), navigate = useNavigate();
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    const state = useCanvasServerTaskStore();
    const connection = useUserStore(state => state.connection);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
    const [, tick] = useState(0);
    const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
    useEffect(() => startCanvasServerTaskPolling(), []);
    useEffect(() => { const timer = setInterval(() => tick(value => value + 1), 1000); return () => clearInterval(timer); }, []);
    useEffect(() => { setOpen(false); setPosition(null); }, [connection?.token]);
    useEffect(() => {
        const resize = () => setPosition(value => value ? { x: Math.max(8, Math.min(innerWidth - 54, value.x)), y: Math.max(8, Math.min(innerHeight - 54, value.y)) } : value);
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, []);
    useEffect(() => { if (!state.total) setOpen(false); }, [state.total]);
    if (!connection?.token || !(location.pathname === "/" || location.pathname.startsWith("/canvas")) || state.total === 0) return null;

    const popupOnLeft = position ? position.x > innerWidth / 2 : true;
    const anchorY = position?.y ?? innerHeight - 124;
    const roomAbove = anchorY, roomBelow = innerHeight - anchorY - 44;
    const popupAbove = roomAbove >= roomBelow;
    const popupMaxHeight = Math.max(80, Math.min(420, (popupAbove ? roomAbove : roomBelow) - 16));
    const tasks = state.active;
    return <div data-canvas-no-zoom className={`fixed z-[1100] ${position ? "" : "bottom-20 right-6"}`} style={position ? { left: position.x, top: position.y } : undefined} onPointerDown={event => event.stopPropagation()}>
        {open ? <section role="dialog" aria-label="进行中的后台任务" className="absolute flex w-[min(320px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border shadow-2xl backdrop-blur-xl" style={{ ...(popupAbove ? { bottom: "calc(100% + 10px)" } : { top: "calc(100% + 10px)" }), ...(popupOnLeft ? { right: 0 } : { left: 0 }), maxHeight: popupMaxHeight, background: theme.node.panel, color: theme.node.text, borderColor: theme.node.stroke }}>
            <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3" style={{ borderColor: theme.node.stroke }}>
                <span className="relative grid size-6 place-items-center rounded-full" style={{ background: theme.node.activeStroke, color: theme.node.panel }}><LoaderCircle className="size-3.5 animate-spin" /></span>
                <strong className="flex-1 text-sm">正在进行 <span className="tabular-nums">{state.total}</span></strong>
                <button type="button" aria-label="刷新任务" title="刷新任务" className="rounded p-1.5 opacity-70 transition hover:opacity-100" onClick={() => void refreshCanvasServerTasks()}><RefreshCw className={`size-4 ${state.loading ? "animate-spin" : ""}`} /></button>
                <button type="button" aria-label="关闭任务列表" title="关闭" className="rounded p-1.5 opacity-70 transition hover:opacity-100" onClick={() => setOpen(false)}><X className="size-4" /></button>
            </header>
            {state.stale ? <div className="border-b px-3 py-1.5 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>连接暂不可用，显示上次同步的任务</div> : null}
            <div className="min-h-0 overflow-auto px-2 py-1.5">
                {tasks.map(task => <button key={`${task.kind}:${task.id}`} type="button" className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2.5 text-left transition hover:bg-black/5" title="进入画布并定位到任务节点" onClick={() => {
                    if (task.projectId) navigate(`/canvas/${encodeURIComponent(task.projectId)}${task.nodeId ? `?${new URLSearchParams({ focusNode: task.nodeId })}` : ""}`);
                    setOpen(false);
                }}>
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md" style={{ background: theme.node.activeStroke + "20", color: theme.node.activeStroke }}><TaskIcon kind={task.kind} /></span>
                    <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                            <span>{kinds[task.kind]}</span><span className="opacity-50">·</span><span className="truncate">{statuses[task.status] || task.status}</span>
                            {task.progress != null ? <span className="ml-auto shrink-0 text-xs tabular-nums opacity-70">{task.progress}%</span> : null}
                        </span>
                        <span className="mt-0.5 block truncate text-xs opacity-75">{task.projectTitle || "未关联画布"}</span>
                        <span className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-[11px]" style={{ color: theme.node.muted }}><span className="truncate">{task.model || "默认模型"}</span><span>·</span><span className="shrink-0">{elapsed(task)}</span></span>
                        {task.error ? <span className="mt-1 block truncate text-xs text-red-500">{task.error}</span> : null}
                    </span>
                    <ChevronRight className="mt-1 size-3.5 shrink-0 opacity-40" />
                </button>)}
                {state.updatedAt ? <p className="px-2 pb-1 pt-1 text-[10px]" style={{ color: theme.node.muted }}>更新于 {new Date(state.updatedAt).toLocaleTimeString()}</p> : null}
            </div>
        </section> : null}
        <button type="button" aria-label={`进行中的后台任务，${state.total} 个`} aria-expanded={open} className="relative grid size-11 touch-none select-none place-items-center rounded-full border shadow-lg transition-transform duration-200 hover:scale-105 active:scale-95" style={{ background: theme.node.panel, color: theme.node.text, borderColor: theme.node.activeStroke }}
            onPointerDown={event => { const rect = event.currentTarget.getBoundingClientRect(); drag.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={event => { const origin = drag.current; if (!origin) return; const dx = event.clientX - origin.x, dy = event.clientY - origin.y; if (Math.abs(dx) + Math.abs(dy) > 5) origin.moved = true; if (origin.moved) setPosition({ x: Math.max(8, Math.min(innerWidth - 54, origin.left + dx)), y: Math.max(8, Math.min(innerHeight - 54, origin.top + dy)) }); }}
            onPointerUp={() => { const moved = drag.current?.moved; drag.current = null; if (!moved) { setOpen(value => !value); void refreshCanvasServerTasks(); } }} onPointerCancel={() => { drag.current = null; }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpen(value => !value); } }}>
            {open ? <ListVideo className="size-5" /> : <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />}
            <span className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-semibold leading-[18px] tabular-nums" style={{ background: theme.node.activeStroke, color: theme.node.panel }}>{state.total}</span>
            {!open ? <span className="absolute inset-0 -z-10 animate-ping rounded-full border opacity-30 motion-reduce:animate-none" style={{ borderColor: theme.node.activeStroke }} /> : null}
        </button>
    </div>;
}
