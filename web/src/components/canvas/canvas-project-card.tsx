import type { CSSProperties } from "react";
import { Check, Download, GitFork, LayoutDashboard, Pencil, Trash2, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Input } from "antd";

import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";

const PROJECT_ACCENTS = [
    { color: "#22d3ee", rgb: "34,211,238" },
    { color: "#a78bfa", rgb: "167,139,250" },
    { color: "#34d399", rgb: "52,211,153" },
    { color: "#fbbf24", rgb: "251,191,36" },
] as const;

export function CanvasProjectCard({ project, accentIndex = 0 }: { project: CanvasProject; accentIndex?: number }) {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const renameProject = useCanvasStore((state) => state.renameProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const editingId = useCanvasUiStore((state) => state.editingProjectId);
    const editingTitle = useCanvasUiStore((state) => state.editingProjectTitle);
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const editing = editingId === project.id;
    const selected = selectedIds.includes(project.id);
    const accent = PROJECT_ACCENTS[accentIndex % PROJECT_ACCENTS.length];
    const open = () => navigate(`/canvas/${project.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`);
    const saveTitle = () => {
        renameProject(project.id, editingTitle);
        stopEditing();
    };

    return (
        <article
            className={`canvas-project-card group flex min-h-44 cursor-pointer flex-col justify-between rounded-lg border p-5 transition ${selected ? "canvas-project-card--selected" : ""}`}
            style={{ "--project-accent": accent.color, "--project-accent-rgb": accent.rgb } as CSSProperties}
            onClick={() => !editing && open()}
        >
            <div className="flex items-start gap-3">
                <input
                    type="checkbox"
                    checked={selected}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => toggleSelected(project.id, event.target.checked)}
                    className="mt-1 size-4"
                    style={{ accentColor: accent.color }}
                    aria-label={`选择 ${project.title}`}
                />
                <span className="canvas-project-card__icon grid size-9 shrink-0 place-items-center rounded-lg">
                    <LayoutDashboard className="size-4.5" />
                </span>
                {editing ? (
                    <Input className="min-w-0 flex-1" value={editingTitle} onClick={(event) => event.stopPropagation()} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveTitle()} autoFocus />
                ) : (
                    <button
                        type="button"
                        className="min-w-0 flex-1 cursor-pointer text-left"
                        onClick={(event) => {
                            event.stopPropagation();
                            open();
                        }}
                    >
                        <h2 className="truncate text-xl font-semibold">{project.title}</h2>
                        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-6 text-stone-600 dark:text-stone-400">
                            <span className="canvas-project-card__stat">
                                <LayoutDashboard className="size-3.5" />
                                {project.nodes.length} 个节点
                            </span>
                            <span className="canvas-project-card__stat canvas-project-card__stat--links">
                                <GitFork className="size-3.5" />
                                {project.connections.length} 条连线
                            </span>
                        </p>
                    </button>
                )}
            </div>
            <div className="mt-8 flex items-end justify-between gap-3">
                <p className="text-xs text-stone-500">更新于 {new Date(project.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                    {editing ? (
                        <>
                            <Button type="text" size="small" shape="circle" className="!text-emerald-500" icon={<Check className="size-4" />} onClick={saveTitle} aria-label="保存名称" />
                            <Button type="text" size="small" shape="circle" icon={<X className="size-4" />} onClick={stopEditing} aria-label="取消重命名" />
                        </>
                    ) : (
                        <>
                            <Button type="text" size="small" shape="circle" className="canvas-project-card__action canvas-project-card__action--export" icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects([project], project.title || "无限画布")} aria-label="导出" />
                            <Button type="text" size="small" shape="circle" className="canvas-project-card__action canvas-project-card__action--edit" icon={<Pencil className="size-4" />} onClick={() => startEditing(project.id, project.title)} aria-label="重命名" />
                            <Button type="text" size="small" shape="circle" className="canvas-project-card__action canvas-project-card__action--delete" icon={<Trash2 className="size-4" />} onClick={() => setDeleteIds([project.id])} aria-label="删除" />
                        </>
                    )}
                </div>
            </div>
        </article>
    );
}
