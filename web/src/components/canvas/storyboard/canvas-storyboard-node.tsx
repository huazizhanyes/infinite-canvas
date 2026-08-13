import { useCallback, useEffect, useState, type ReactNode } from "react";
import { App, Button, Dropdown, Empty, Input, InputNumber, Select, Spin, Tag } from "antd";
import { Clapperboard, Copy, Download, Film, ImagePlus, Minimize2, Plus, Save, Sparkles } from "lucide-react";
import { nanoid } from "nanoid";

import { canvasStoryboardApi, notifyStoryboardUpdated, type Storyboard, type StoryboardScene, type StoryboardShot } from "@/services/api/canvas-storyboard";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import { CanvasNodeType } from "@/types/canvas";

type StoryboardTheme = CanvasNodeContext["theme"];

const longFields = ["visualDescription", "characterAction", "dialogue", "narration", "sound", "music", "continuity", "imagePrompt", "videoPrompt"];
const wideFields = new Set(["visualDescription", "dialogue", "narration", "imagePrompt", "videoPrompt"]);
const fieldLabels: Record<string, string> = {
    visualDescription: "画面描述",
    characterAction: "人物动作",
    dialogue: "对白",
    narration: "旁白",
    sound: "环境音",
    music: "音乐",
    transition: "转场",
    continuity: "连续性",
    imagePrompt: "图片提示词",
    videoPrompt: "视频提示词",
};
const statusLabels: Record<string, string> = { idle: "待分析", queued: "排队中", running: "分析中", success: "已完成", succeeded: "已完成", error: "失败" };

export function CanvasStoryboardNode({ ctx }: { ctx: CanvasNodeContext }) {
    const { message, modal } = App.useApp();
    const connection = useUserStore((state) => state.connection);
    const storyboardId = ctx.node.metadata?.storyboardId;
    const sourceNode = (ctx.node.metadata?.sourceNodeId ? ctx.getNode(ctx.node.metadata.sourceNodeId) : null) || ctx.getUpstream().find((node) => node.type === CanvasNodeType.Text) || null;
    const sourceContent = sourceNode?.metadata?.content || sourceNode?.metadata?.prompt || "";
    const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
    const [loading, setLoading] = useState(Boolean(storyboardId));
    const [expanded, setExpanded] = useState(() => ctx.node.width > 360 || ctx.node.height > 210);
    const [sceneId, setSceneId] = useState<string>();
    const [shotId, setShotId] = useState<string>();
    const [analyzing, setAnalyzing] = useState(false);
    const [density, setDensity] = useState("standard");
    const [duration, setDuration] = useState(60);

    const load = useCallback(async () => {
        if (!connection || !storyboardId) return;
        setLoading(true);
        try {
            const data = await canvasStoryboardApi.get(connection, storyboardId);
            setStoryboard(data);
            setDensity(data.density);
            setDuration(data.targetDuration || 60);
            setSceneId((current) => (current && data.scenes.some((scene) => scene.id === current) ? current : data.scenes[0]?.id));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "分镜加载失败");
        } finally {
            setLoading(false);
        }
    }, [connection, message, storyboardId]);

    useEffect(() => {
        void load();
    }, [load]);
    useEffect(() => {
        const refresh = (event: Event) => {
            if ((event as CustomEvent<{ storyboardId?: string }>).detail?.storyboardId === storyboardId) void load();
        };
        window.addEventListener("canvas-storyboard-updated", refresh);
        return () => window.removeEventListener("canvas-storyboard-updated", refresh);
    }, [load, storyboardId]);

    const scenes = storyboard?.scenes || [];
    const activeScene = scenes.find((scene) => scene.id === sceneId) || scenes[0];
    const activeShot = activeScene?.shots.find((shot) => shot.id === shotId);
    const shotCount = scenes.reduce((sum, scene) => sum + scene.shots.length, 0);
    const reviewCount = scenes.reduce((sum, scene) => sum + scene.shots.filter((shot) => shot.needsReview).length, 0);
    const totalDuration = scenes.reduce((sum, scene) => sum + scene.shots.reduce((inner, shot) => inner + shot.durationSec, 0), 0);

    useEffect(() => {
        if (!activeScene?.shots.some((shot) => shot.id === shotId)) setShotId(activeScene?.shots[0]?.id);
    }, [activeScene, shotId]);

    const toggleExpanded = () => {
        const next = !expanded;
        setExpanded(next);
        const width = next ? 720 : 360;
        const height = next ? 540 : 210;
        ctx.updateNode({ width, height });
        window.setTimeout(() => ctx.emit("canvas-fit-node", { nodeId: ctx.node.id, width, height, padding: 48 }), 0);
    };

    const generateImageFromPrompt = (prompt: string) => {
        const value = prompt.trim();
        if (!value) {
            message.warning("请先填写图片提示词");
            return;
        }
        const id = `storyboard-image-${nanoid(8)}`;
        ctx.applyOps([
            {
                type: "add_node",
                id,
                nodeType: CanvasNodeType.Image,
                title: `镜头 ${activeShot?.shotNo || ""} 图片`,
                position: { x: ctx.node.position.x + ctx.node.width + 96, y: ctx.node.position.y },
                width: 340,
                height: 240,
                metadata: { prompt: value, status: "idle", generationMode: "image", generationType: "generation" },
            },
            { type: "connect_nodes", fromNodeId: ctx.node.id, toNodeId: id },
            { type: "run_generation", nodeId: id, mode: "image", prompt: value },
        ]);
        message.success("已创建图片节点并开始生成");
    };

    const updateShot = async (field: string, value: unknown) => {
        if (!connection || !activeShot) return;
        const updated = await canvasStoryboardApi.updateShot(connection, activeShot.id, { [field]: value });
        setStoryboard((current) => (current ? { ...current, scenes: current.scenes.map((scene) => ({ ...scene, shots: scene.shots.map((shot) => (shot.id === updated.id ? updated : shot)) })) } : current));
    };

    const duplicateShot = async () => {
        if (!connection || !activeShot) return;
        const copied = await canvasStoryboardApi.duplicateShot(connection, activeShot.id);
        setStoryboard((current) => (current ? { ...current, scenes: current.scenes.map((scene) => (scene.id === activeShot.sceneId ? { ...scene, shots: [...scene.shots, copied] } : scene)) } : current));
        setShotId(copied.id);
    };

    const copyPrompt = async (value: string) => {
        if (!value) return;
        await navigator.clipboard?.writeText(value);
        message.success("提示词已复制");
    };

    const exportFile = async (format: "md" | "csv" | "json") => {
        if (!connection || !storyboardId) return;
        const file = await canvasStoryboardApi.export(connection, storyboardId, format);
        const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = file.filename;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    const analyze = async () => {
        if (!connection || !storyboardId) return;
        if (!sourceNode) {
            message.warning("请先连接一个文本节点");
            return;
        }
        if (!sourceContent.trim()) {
            message.warning("请先在上游文本节点填写来源文本");
            return;
        }
        const run = await canvasStoryboardApi.analyze(connection, storyboardId, {
            content: sourceContent,
            density,
            targetDuration: duration,
            sourceScope: ctx.node.metadata?.sourceScope || "full",
            requestId: `storyboard-${storyboardId}-${Date.now()}`,
        });
        setAnalyzing(true);
        const poll = async () => {
            const latest = await canvasStoryboardApi.analysis(connection, run.id);
            if (latest.status === "queued" || latest.status === "running") {
                window.setTimeout(poll, 3000);
                return;
            }
            setAnalyzing(false);
            if (latest.status === "succeeded") {
                message.success("分镜生成完成");
                notifyStoryboardUpdated(storyboardId);
                await load();
            } else message.error(latest.error || "分镜分析失败");
        };
        void poll();
    };

    return (
        <div
            className="flex h-full w-full flex-col overflow-hidden"
            data-canvas-no-zoom
            style={{ color: ctx.theme.node.text, background: ctx.theme.node.panel }}
            onPointerDown={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest("button,input,textarea,select,[role=button]")) event.stopPropagation();
            }}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.toolbar.panel }}>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.toolbar.activeText }}>
                    <Clapperboard className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold tracking-tight">{storyboard?.title || ctx.node.title}</span>
                    <span className="mt-0.5 block truncate text-[11px]" style={{ color: ctx.theme.node.faint }}>
                        {loading ? "正在加载..." : `${scenes.length} 场景 · ${shotCount} 镜头 · ${Math.round(totalDuration)}秒`}
                    </span>
                </span>
                <StatusBadge status={analyzing ? "running" : storyboard?.status} theme={ctx.theme} />
                <button type="button" className="grid size-8 place-items-center rounded-lg transition hover:bg-black/5" style={{ color: ctx.theme.node.muted }} onClick={toggleExpanded} aria-label={expanded ? "收起" : "展开"}>
                    {expanded ? <Minimize2 className="size-4" /> : <Plus className="size-4" />}
                </button>
            </div>
            {loading ? (
                <div className="grid min-h-0 flex-1 place-items-center" style={{ color: ctx.theme.node.muted }}>
                    <Spin />
                </div>
            ) : expanded ? (
                <ExpandedContent
                    theme={ctx.theme}
                    scenes={scenes}
                    activeScene={activeScene}
                    activeShot={activeShot}
                    sceneId={sceneId}
                    shotId={shotId}
                    setSceneId={setSceneId}
                    setShotId={setShotId}
                    density={density}
                    duration={duration}
                    setDensity={setDensity}
                    setDuration={setDuration}
                    analyzing={analyzing}
                    onAnalyze={() => void analyze()}
                    onUpdateShot={updateShot}
                    onDuplicate={duplicateShot}
                    onCopyPrompt={copyPrompt}
                    onGenerateImage={generateImageFromPrompt}
                    onExport={exportFile}
                />
            ) : (
                <CollapsedContent theme={ctx.theme} scenes={scenes} shotCount={shotCount} reviewCount={reviewCount} storyboard={storyboard} onExpand={toggleExpanded} />
            )}
        </div>
    );
}

function CollapsedContent({ theme, scenes, shotCount, reviewCount, storyboard, onExpand }: { theme: StoryboardTheme; scenes: StoryboardScene[]; shotCount: number; reviewCount: number; storyboard: Storyboard | null; onExpand: () => void }) {
    return (
        <button type="button" className="flex min-h-0 w-full flex-1 flex-col p-3 text-left transition hover:bg-black/[.03]" style={{ color: theme.node.text }} onClick={onExpand}>
            <div className="grid grid-cols-3 gap-2">
                <Stat theme={theme} icon={<Film className="size-3.5" />} label="场景" value={scenes.length} />
                <Stat theme={theme} icon={<Clapperboard className="size-3.5" />} label="镜头" value={shotCount} />
                <Stat theme={theme} icon={<span className="text-[13px]">!</span>} label="待确认" value={reviewCount} />
            </div>
            <div className="mt-auto flex items-center justify-between gap-3 text-[11px]" style={{ color: theme.node.faint }}>
                <span>
                    {storyboard?.aspectRatio || "16:9"} · {storyboard?.density === "detailed" ? "细致" : storyboard?.density === "concise" ? "简略" : "标准"}
                </span>
                <span>点击展开卡片</span>
            </div>
        </button>
    );
}

function ExpandedContent({
    theme,
    scenes,
    activeScene,
    activeShot,
    sceneId,
    shotId,
    setSceneId,
    setShotId,
    density,
    duration,
    setDensity,
    setDuration,
    analyzing,
    onAnalyze,
    onUpdateShot,
    onDuplicate,
    onCopyPrompt,
    onGenerateImage,
    onExport,
}: {
    theme: StoryboardTheme;
    scenes: StoryboardScene[];
    activeScene?: StoryboardScene;
    activeShot?: StoryboardShot;
    sceneId?: string;
    shotId?: string;
    setSceneId: (id: string) => void;
    setShotId: (id: string) => void;
    density: string;
    duration: number;
    setDensity: (value: string) => void;
    setDuration: (value: number) => void;
    analyzing: boolean;
    onAnalyze: () => void;
    onUpdateShot: (field: string, value: unknown) => Promise<void>;
    onDuplicate: () => Promise<void>;
    onCopyPrompt: (value: string) => Promise<void>;
    onGenerateImage: (value: string) => void;
    onExport: (format: "md" | "csv" | "json") => Promise<void>;
}) {
    return (
        <div className="flex min-h-0 flex-1 flex-col" style={{ background: theme.node.panel }}>
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.toolbar.panel }}>
                <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: theme.node.faint }}>
                    分析设置
                </span>
                <Select
                    size="small"
                    value={density}
                    onChange={setDensity}
                    options={[
                        { value: "concise", label: "简略" },
                        { value: "standard", label: "标准" },
                        { value: "detailed", label: "细致" },
                    ]}
                />
                <InputNumber size="small" min={1} max={3600} value={duration} addonAfter="秒" onChange={(value) => setDuration(Number(value || 60))} />
                <Button size="small" type="primary" loading={analyzing} icon={<Sparkles className="size-3.5" />} onClick={onAnalyze}>
                    生成
                </Button>
                <Dropdown
                    menu={{
                        items: [
                            { key: "md", label: "Markdown", onClick: () => void onExport("md") },
                            { key: "csv", label: "CSV", onClick: () => void onExport("csv") },
                            { key: "json", label: "JSON", onClick: () => void onExport("json") },
                        ],
                    }}
                >
                    <Button size="small" aria-label="导出" icon={<Download className="size-3.5" />} />
                </Dropdown>
                <span className="ml-auto text-[10px]" style={{ color: theme.node.faint }}>
                    仅生成文案和提示词
                </span>
            </div>
            {scenes.length ? (
                <>
                    <div className="thin-scrollbar flex gap-1.5 overflow-x-auto border-b px-4 py-2" style={{ borderColor: theme.node.stroke }}>
                        {scenes.map((scene) => (
                            <button
                                type="button"
                                key={scene.id}
                                className="shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium transition"
                                style={{ background: scene.id === sceneId ? theme.toolbar.activeBg : "transparent", color: scene.id === sceneId ? theme.toolbar.activeText : theme.node.muted }}
                                onClick={() => setSceneId(scene.id)}
                            >
                                场 {scene.sceneNo} · {scene.title}
                            </button>
                        ))}
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
                        <div className="mb-2 flex items-end justify-between gap-2">
                            <div>
                                <div className="text-[12px] font-semibold">{activeScene?.title}</div>
                                <div className="mt-1 text-[11px]" style={{ color: theme.node.faint }}>
                                    {activeScene?.location || "未设置地点"}
                                    {activeScene?.time ? ` · ${activeScene.time}` : ""}
                                </div>
                            </div>
                            <span className="text-[11px]" style={{ color: theme.node.faint }}>
                                {activeScene?.shots.length || 0} 镜头
                            </span>
                        </div>
                        <div className="grid min-h-0 flex-1 gap-2 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
                            <div className="thin-scrollbar min-h-0 space-y-2 overflow-y-auto pr-1">
                                {activeScene?.shots.map((shot) => (
                                    <ShotCard key={shot.id} theme={theme} shot={shot} active={shot.id === shotId} onClick={() => setShotId(shot.id)} />
                                ))}
                            </div>
                            <div className="thin-scrollbar min-h-0 overflow-y-auto pr-1">
                                {activeShot ? (
                                    <InlineShotEditor theme={theme} shot={activeShot} onUpdate={onUpdateShot} onDuplicate={onDuplicate} onCopyPrompt={onCopyPrompt} onGenerateImage={onGenerateImage} />
                                ) : (
                                    <div className="grid h-full place-items-center rounded-md border border-dashed text-[11px]" style={{ borderColor: theme.node.stroke, color: theme.node.faint }}>
                                        选择一个镜头开始编辑
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </>
            ) : (
                <div className="grid flex-1 place-items-center p-4">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先点击生成" />
                </div>
            )}
        </div>
    );
}

function ShotCard({ theme, shot, active, onClick }: { theme: StoryboardTheme; shot: StoryboardShot; active: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            className="rounded-md border p-2 text-left transition hover:bg-black/[.03]"
            style={{ borderColor: active ? theme.toolbar.activeText : theme.node.stroke, background: active ? theme.toolbar.activeBg : theme.node.fill, color: theme.node.text }}
            onClick={onClick}
        >
            <div className="flex items-start gap-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg text-[11px] font-bold" style={{ background: active ? theme.toolbar.activeText : theme.toolbar.activeBg, color: active ? theme.node.panel : theme.node.muted }}>
                    {shot.shotNo}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{shot.title || shot.shotSize || "未命名镜头"}</span>
                    <span className="mt-1 line-clamp-2 block text-[11px] leading-4" style={{ color: theme.node.muted }}>
                        {shot.visualDescription || "暂无画面描述"}
                    </span>
                </span>
                <span className="shrink-0 text-[10px] font-medium" style={{ color: theme.node.faint }}>
                    {shot.durationSec}s
                </span>
            </div>
            {shot.needsReview ? (
                <Tag className="mt-2" bordered={false} color="orange">
                    待确认
                </Tag>
            ) : null}
        </button>
    );
}

function InlineShotEditor({
    theme,
    shot,
    onUpdate,
    onDuplicate,
    onCopyPrompt,
    onGenerateImage,
}: {
    theme: StoryboardTheme;
    shot: StoryboardShot;
    onUpdate: (field: string, value: unknown) => Promise<void>;
    onDuplicate: () => Promise<void>;
    onCopyPrompt: (value: string) => Promise<void>;
    onGenerateImage: (value: string) => void;
}) {
    return (
        <div className="rounded-md border p-3" style={{ borderColor: theme.toolbar.activeText, background: theme.toolbar.panel }}>
            <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                    <span className="block text-xs font-semibold">编辑镜头 #{shot.shotNo}</span>
                    <span className="mt-1 block text-[10px]" style={{ color: theme.node.faint }}>
                        修改后即时保存
                    </span>
                </div>
                <div className="flex gap-1.5">
                    <Button size="small" icon={<Copy className="size-3" />} onClick={() => void onDuplicate()}>
                        复制
                    </Button>
                    <Button size="small" type="primary" icon={<Save className="size-3" />} onClick={() => void onUpdate("title", shot.title)}>
                        保存
                    </Button>
                </div>
            </div>
            <div className="grid gap-2">
                {longFields.map((field) => (
                    <label key={field} className={wideFields.has(field) ? "sm:col-span-2" : ""}>
                        <span className="mb-1.5 flex items-center gap-1 text-[10px] font-medium" style={{ color: theme.node.muted }}>
                            {fieldLabels[field]} {shot.lockedFields?.[field] ? "🔒" : ""}
                        </span>
                        <Input.TextArea value={String((shot as Record<string, unknown>)[field] || "")} autoSize={{ minRows: wideFields.has(field) ? 2 : 1, maxRows: 4 }} onChange={(event) => void onUpdate(field, event.target.value)} />
                        <div className="mt-1 flex justify-end">
                            {field === "imagePrompt" ? (
                                <Button type="link" size="small" icon={<ImagePlus className="size-3" />} onClick={() => onGenerateImage(String((shot as Record<string, unknown>)[field] || ""))}>
                                    生成图片
                                </Button>
                            ) : null}
                            {field === "imagePrompt" || field === "videoPrompt" ? (
                                <Button type="link" size="small" icon={<Copy className="size-3" />} onClick={() => void onCopyPrompt(String((shot as Record<string, unknown>)[field] || ""))}>
                                    复制提示词
                                </Button>
                            ) : null}
                        </div>
                    </label>
                ))}
            </div>
        </div>
    );
}

function Stat({ theme, icon, label, value }: { theme: StoryboardTheme; icon: ReactNode; label: string; value: number }) {
    return (
        <span className="flex min-w-0 flex-col gap-1 rounded-md border px-2 py-2" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
            <span className="flex items-center gap-1.5 text-[10px]" style={{ color: theme.node.faint }}>
                {icon}
                {label}
            </span>
            <span className="text-sm font-semibold" style={{ color: theme.node.text }}>
                {value}
            </span>
        </span>
    );
}

function StatusBadge({ status, theme }: { status?: string; theme: StoryboardTheme }) {
    if (!status) return null;
    const running = status === "running" || status === "queued";
    const success = status === "success" || status === "succeeded";
    return (
        <span
            className="rounded-md px-2 py-0.5 text-[10px] font-semibold"
            style={{ background: success ? "rgba(34,197,94,.14)" : running ? "rgba(245,158,11,.14)" : "rgba(148,163,184,.16)", color: success ? "#4ade80" : running ? "#fbbf24" : theme.node.muted }}
        >
            {running ? "分析中" : statusLabels[status] || status}
        </span>
    );
}
