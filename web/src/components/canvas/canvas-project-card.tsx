import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Check, Download, Image as ImageIcon, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Dropdown, Input, type MenuProps } from "antd";

import { resolvePersistedImage } from "@/services/image-storage";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { CanvasNodeType } from "@/types/canvas";

function useProjectCover(project: CanvasProject) {
    const coverNode = useMemo(
        () => project.nodes.find((node) => (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.ScriptAsset) && Boolean(node.metadata?.content || node.metadata?.storageKey || node.metadata?.mediaId)),
        [project.nodes],
    );
    const [coverUrl, setCoverUrl] = useState("");

    useEffect(() => {
        let cancelled = false;
        const metadata = coverNode?.metadata;
        if (!metadata) {
            setCoverUrl("");
            return;
        }
        const fallback = metadata.content || "";
        setCoverUrl(fallback);
        if (!metadata.storageKey && !metadata.mediaId) return;
        void resolvePersistedImage(metadata.mediaId, metadata.storageKey, fallback)
            .then((resolved) => {
                if (!cancelled) setCoverUrl(resolved.url || fallback);
            })
            .catch(() => {
                if (!cancelled) setCoverUrl(fallback);
            });
        return () => {
            cancelled = true;
        };
    }, [coverNode]);

    return [coverUrl, setCoverUrl] as const;
}

export function CanvasProjectCard({ project, index = 0 }: { project: CanvasProject; index?: number }) {
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
    const [coverUrl, setCoverUrl] = useProjectCover(project);
    const open = () => navigate(`/canvas/${project.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`);
    const saveTitle = () => {
        renameProject(project.id, editingTitle);
        stopEditing();
    };
    const stopCardClick = (event: MouseEvent) => event.stopPropagation();
    const actions: MenuProps["items"] = [
        {
            key: "export",
            label: "导出画布",
            icon: <Download className="size-4" />,
            onClick: ({ domEvent }) => {
                domEvent.stopPropagation();
                void exportCanvasProjects([project], project.title || "无限画布");
            },
        },
        {
            key: "rename",
            label: "重命名",
            icon: <Pencil className="size-4" />,
            onClick: ({ domEvent }) => {
                domEvent.stopPropagation();
                startEditing(project.id, project.title);
            },
        },
        {
            key: "delete",
            label: "删除",
            danger: true,
            icon: <Trash2 className="size-4" />,
            onClick: ({ domEvent }) => {
                domEvent.stopPropagation();
                setDeleteIds([project.id]);
            },
        },
    ];

    return (
        <article className={`canvas-project-card group cursor-pointer ${selected ? "canvas-project-card--selected" : ""}`} onClick={() => !editing && open()} aria-label={`打开 ${project.title}`}>
            <div className="canvas-project-card__cover">
                {coverUrl ? (
                    <img src={coverUrl} alt={`${project.title}封面`} loading="lazy" onError={() => setCoverUrl("")} />
                ) : (
                    <div className="canvas-project-card__placeholder"><ImageIcon className="size-8" /></div>
                )}
                <label className="canvas-project-card__select" onClick={stopCardClick}>
                    <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => toggleSelected(project.id, event.target.checked)}
                        aria-label={`选择 ${project.title}`}
                    />
                    <span aria-hidden="true">{selected ? <Check className="size-3.5" /> : null}</span>
                </label>
            </div>

            <div className="canvas-project-card__meta">
                {editing ? (
                    <Input className="min-w-0 flex-1" value={editingTitle} onClick={stopCardClick} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveTitle()} autoFocus />
                ) : (
                    <button type="button" className="canvas-project-card__title" onClick={(event) => { event.stopPropagation(); open(); }} title={project.title}>
                        {project.title}
                    </button>
                )}
                <div className="canvas-project-card__actions" onClick={stopCardClick}>
                    {editing ? (
                        <>
                            <Button type="text" size="small" shape="circle" className="!text-emerald-500" icon={<Check className="size-4" />} onClick={saveTitle} aria-label="保存名称" />
                            <Button type="text" size="small" shape="circle" icon={<X className="size-4" />} onClick={stopEditing} aria-label="取消重命名" />
                        </>
                    ) : (
                        <Dropdown menu={{ items: actions }} placement="bottomRight" trigger={["click"]}>
                            <Button type="text" size="small" shape="circle" className="canvas-project-card__action" icon={<MoreHorizontal className="size-4" />} aria-label="更多操作" />
                        </Dropdown>
                    )}
                </div>
            </div>
            <time className="canvas-project-card__date" dateTime={project.updatedAt}>{new Date(project.updatedAt).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" })}</time>
        </article>
    );
}
