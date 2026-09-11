import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button, Dropdown, Input, type MenuProps } from "antd";
import { Download, FileUp, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import type { CanvasExportFile } from "@/types/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";

export default function CanvasPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedProjectIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);

    const [query, setQuery] = useState("");
    const filteredProjects = useMemo(() => {
        const keyword = query.trim().toLocaleLowerCase();
        if (!keyword) return projects;
        return projects.filter((project) => project.title.toLocaleLowerCase().includes(keyword));
    }, [projects, query]);
    const moreActions: MenuProps["items"] = [
        {
            key: "delete-all",
            danger: true,
            icon: <Trash2 className="size-4" />,
            label: "删除全部",
            disabled: !hydrated || !projects.length,
            onClick: () => setDeleteIds(projects.map((project) => project.id)),
        },
    ];
    const clearSelection = () => removeSelectedProjectIds(selectedIds);

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => {
        navigate(`/canvas/${id}${agentQuery}`);
    };
    const createAndEnter = () => enterProject(createProject(`无限画布 ${projects.length + 1}`));
    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            await Promise.all(
                data.projects.flatMap((project) =>
                    project.files.map(async (item) => {
                        const blob = zip.get(item.path);
                        if (!blob) return;
                        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
                        await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
                    }),
                ),
            );
            data.projects.forEach((item) => importProject(item.project));
            message.success(`已导入 ${data.projects.length} 个画布`);
        } catch {
            message.error("导入失败，请选择有效的画布压缩包");
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        enterProject(mode === "new" ? createProject(`无限画布 ${projects.length + 1}`) : projects[0]?.id || createProject(`无限画布 ${projects.length + 1}`));
    }, [createProject, hydrated, mode, projects]);

    if (hydrated && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">正在打开画布...</main>;

    return (
        <main className="canvas-library-shell h-full overflow-auto text-stone-950 dark:text-stone-100">
            <div className="canvas-library-content mx-auto flex w-full max-w-[1480px] flex-col gap-7 px-6 py-9 lg:px-10">
                <header className="canvas-library-header">
                    <div className="canvas-library-section-title">全部项目</div>
                    <div className="canvas-library-actions">
                        <Input
                            className="canvas-library-search"
                            allowClear
                            prefix={<Search className="size-4" />}
                            placeholder="搜索项目"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                        />
                        <Button className="canvas-library-action canvas-library-action--ghost" disabled={!hydrated} icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                            导入画布
                        </Button>
                        <Dropdown menu={{ items: moreActions }} placement="bottomRight" trigger={["click"]}>
                            <Button className="canvas-library-action canvas-library-action--more" disabled={!hydrated || !projects.length} icon={<MoreHorizontal className="size-4" />} aria-label="更多操作" />
                        </Dropdown>
                    </div>
                </header>

                {selectedIds.length ? (
                    <div className="canvas-library-selection">
                        <span>已选择 {selectedIds.length} 个画布</span>
                        <div>
                            <Button className="canvas-library-selection__button" icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects(projects.filter((project) => selectedIds.includes(project.id)), `无限画布-${selectedIds.length}个项目`)}>
                                导出
                            </Button>
                            <Button className="canvas-library-selection__button canvas-library-selection__button--danger" onClick={() => setDeleteIds(selectedIds)}>删除</Button>
                            <Button type="text" className="canvas-library-selection__button canvas-library-selection__button--cancel" onClick={clearSelection}>取消选择</Button>
                        </div>
                    </div>
                ) : null}

                {!hydrated ? (
                    <section className="canvas-library-loading">
                        <span />
                        <span />
                        <span />
                        正在加载画布...
                    </section>
                ) : (
                    <>
                        <div className="canvas-project-grid">
                            <button type="button" className="canvas-project-create-card" onClick={createAndEnter}>
                                <span className="canvas-project-create-card__cover"><Plus className="size-7" /></span>
                                <span className="canvas-project-create-card__title">创建新的画布</span>
                                <span className="canvas-project-create-card__date">立即开始</span>
                            </button>
                            {filteredProjects.map((project) => (
                                <CanvasProjectCard key={project.id} project={project} />
                            ))}
                        </div>
                        {query && !filteredProjects.length ? <p className="canvas-library-empty-text">没有找到匹配的项目</p> : null}
                        {!query && projects.length ? <p className="canvas-library-empty-text">没有更多了</p> : null}
                    </>
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}
