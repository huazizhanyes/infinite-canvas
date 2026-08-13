import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { App, Button, Checkbox, Empty, Input, Modal, Popconfirm, Progress, Select, Spin, Tabs, Tag } from "antd";
import { Boxes, ImagePlus, LoaderCircle, Plus, Save, Sparkles, Trash2, UsersRound, Warehouse } from "lucide-react";
import { nanoid } from "nanoid";

import { canvasScriptApi, notifyScriptSetUpdated, type ScriptAnalysisRun, type ScriptAsset, type ScriptAssetType, type ScriptGenerationImage, type ScriptGenerationBatch, type ScriptPendingMention, type ScriptSet } from "@/services/api/canvas-script";
import { useUserStore } from "@/stores/use-user-store";

const TYPE_LABEL: Record<ScriptAssetType, string> = { character: "人物", scene: "场景", prop: "道具" };

export function CanvasScriptWorkspace({
    scriptSetId,
    active,
    refreshNonce,
    onError,
    onImagesReady,
}: {
    scriptSetId?: string;
    active: boolean;
    refreshNonce: number;
    onError: (error: string | null) => void;
    onImagesReady: (images: ScriptGenerationImage[]) => void;
}) {
    const { message, modal } = App.useApp();
    const connection = useUserStore((state) => state.connection);
    const imageBalance = useUserStore((state) => state.assets?.assets.image.totalAvailable || 0);
    const refreshUserAssets = useUserStore((state) => state.loadAssets);
    const [scriptSet, setScriptSet] = useState<ScriptSet | null>(null);
    const [assets, setAssets] = useState<ScriptAsset[]>([]);
    const [pending, setPending] = useState<ScriptPendingMention[]>([]);
    const [activeEpisodeId, setActiveEpisodeId] = useState<string>();
    const [episodeTitle, setEpisodeTitle] = useState("");
    const [episodeContent, setEpisodeContent] = useState("");
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [analysis, setAnalysis] = useState<ScriptAnalysisRun | null>(null);
    const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
    const [assetType, setAssetType] = useState<ScriptAssetType | "all">("all");
    const [editingAsset, setEditingAsset] = useState<ScriptAsset | null>(null);
    const [generating, setGenerating] = useState(false);
    const [generationBatch, setGenerationBatch] = useState<ScriptGenerationBatch | null>(null);
    const onErrorRef = useRef(onError);
    const onImagesReadyRef = useRef(onImagesReady);

    onErrorRef.current = onError;
    onImagesReadyRef.current = onImagesReady;

    const activeEpisode = scriptSet?.episodes.find((item) => item.id === activeEpisodeId);

    const load = useCallback(async () => {
        if (!connection || !scriptSetId) return;
        setLoading(true);
        try {
            const [nextSet, assetData] = await Promise.all([canvasScriptApi.getSet(connection, scriptSetId), canvasScriptApi.listAssets(connection, scriptSetId)]);
            onErrorRef.current(null);
            setScriptSet(nextSet);
            setAssets(assetData.assets);
            setPending(assetData.pending);
            setActiveEpisodeId((current) => (current && nextSet.episodes.some((item) => item.id === current) ? current : nextSet.episodes[0]?.id));
            const validTargetKeys = new Set(assetData.assets.flatMap((asset) => [`${asset.id}:`, ...asset.variants.map((variant) => `${asset.id}:${variant.id}`)]));
            setSelectedTargets((current) => new Set([...current].filter((key) => validTargetKeys.has(key))));
            const available = assetData.assets.flatMap((asset) => [
                ...(asset.image?.imageUrl ? [{ id: asset.image.id, assetId: asset.id, assetType: asset.type, assetName: asset.name, status: "success", imageUrl: asset.image.imageUrl, selected: true }] : []),
                ...asset.variants.flatMap((variant) =>
                    variant.image?.imageUrl ? [{ id: variant.image.id, assetId: asset.id, variantId: variant.id, assetType: asset.type, assetName: variant.name, status: "success", imageUrl: variant.image.imageUrl, selected: true }] : [],
                ),
            ]);
            if (available.length) onImagesReadyRef.current(available);
        } catch (error) {
            const reason = readError(error);
            onErrorRef.current(reason);
            message.error(reason);
        } finally {
            setLoading(false);
        }
    }, [connection, message, scriptSetId]);

    useEffect(() => {
        if (active) void load();
    }, [active, load, refreshNonce]);

    useEffect(() => {
        if (!activeEpisode) return;
        setEpisodeTitle(activeEpisode.title);
        setEpisodeContent(activeEpisode.content);
    }, [activeEpisode]);

    const saveEpisode = async () => {
        if (!connection || !activeEpisode) return null;
        setSaving(true);
        try {
            const updated = await canvasScriptApi.updateEpisode(connection, activeEpisode.id, { title: episodeTitle, content: episodeContent });
            setScriptSet((current) => (current ? { ...current, episodes: current.episodes.map((item) => (item.id === updated.id ? updated : item)) } : current));
            message.success("本集已保存");
            return updated;
        } catch (error) {
            message.error(readError(error));
            return null;
        } finally {
            setSaving(false);
        }
    };

    const addEpisode = async () => {
        if (!connection || !scriptSet) return;
        try {
            const episode = await canvasScriptApi.createEpisode(connection, scriptSet.id);
            setScriptSet({ ...scriptSet, episodes: [...scriptSet.episodes, episode], stats: { ...scriptSet.stats, episodeCount: scriptSet.stats.episodeCount + 1 } });
            setActiveEpisodeId(episode.id);
            notifyScriptSetUpdated(scriptSet.id);
        } catch (error) {
            message.error(readError(error));
        }
    };

    const deleteEpisode = async (id: string) => {
        if (!connection || !scriptSet) return;
        try {
            await canvasScriptApi.deleteEpisode(connection, id);
            const episodes = scriptSet.episodes.filter((item) => item.id !== id);
            setScriptSet({ ...scriptSet, episodes, stats: { ...scriptSet.stats, episodeCount: episodes.length } });
            setActiveEpisodeId(episodes[0]?.id);
            notifyScriptSetUpdated(scriptSet.id);
        } catch (error) {
            message.error(readError(error));
        }
    };

    const analyzeEpisode = async () => {
        if (!connection || !activeEpisode) return;
        const saved = await saveEpisode();
        if (!saved) return;
        try {
            const run = await canvasScriptApi.analyzeEpisode(connection, activeEpisode.id, nanoid());
            setAnalysis(run);
            void pollAnalysis(run.id);
        } catch (error) {
            message.error(readError(error));
        }
    };

    const pollAnalysis = async (runId: string) => {
        if (!connection) return;
        try {
            const run = await canvasScriptApi.getAnalysis(connection, runId);
            setAnalysis(run);
            if (run.status === "queued" || run.status === "running") {
                window.setTimeout(() => void pollAnalysis(runId), 3000);
                return;
            }
            if (run.status === "succeeded") {
                message.success("资产分析完成");
                await Promise.all([load(), refreshUserAssets()]);
                if (scriptSetId) notifyScriptSetUpdated(scriptSetId);
            } else {
                message.error(run.error || "资产分析失败");
            }
        } catch (error) {
            message.error(readError(error));
        }
    };

    const saveSetSettings = async () => {
        if (!connection || !scriptSet) return;
        try {
            const updated = await canvasScriptApi.updateSet(connection, scriptSet.id, {
                title: scriptSet.title,
                visualStyle: scriptSet.visualStyle,
                aspectRatio: scriptSet.aspectRatio,
                imageQuality: scriptSet.imageQuality,
            });
            setScriptSet(updated);
            notifyScriptSetUpdated(updated.id);
            message.success("剧本集设置已保存");
        } catch (error) {
            message.error(readError(error));
        }
    };

    const resolvePending = async (item: ScriptPendingMention, decision: "reuse" | "variant" | "new") => {
        if (!connection) return;
        try {
            await canvasScriptApi.resolveMention(connection, item.id, decision, decision === "new" ? undefined : item.suggestedAsset?.id);
            await load();
            if (scriptSetId) notifyScriptSetUpdated(scriptSetId);
        } catch (error) {
            message.error(readError(error));
        }
    };

    const generate = async () => {
        if (!connection || !scriptSet || !selectedTargets.size) return;
        const targets = [...selectedTargets].map((value) => {
            const [assetId, variantId] = value.split(":");
            return { assetId, ...(variantId ? { variantId } : {}) };
        });
        modal.confirm({
            title: "生成资产图片",
            content: `本次将为 ${targets.length} 个已选资产/变体各创建 1 个图片任务，预计消耗 ${targets.length} 张图片额度。当前可用 ${imageBalance} 张。任务开始后会立即在画布中显示占位节点，完成后原位更新为结果图片。`,
            okText: "开始生成",
            cancelText: "取消",
            onOk: async () => {
                setGenerating(true);
                try {
                    const batch = await canvasScriptApi.generateAssets(connection, scriptSet.id, targets, nanoid());
                    setGenerationBatch(batch);
                    onImagesReady(batch.images);
                    message.info("已在画布创建生成占位节点，正在生成图片...");
                    void pollGeneration(batch.id);
                } catch (error) {
                    setGenerating(false);
                    message.error(readError(error));
                }
            },
        });
    };

    const pollGeneration = async (batchId: string) => {
        if (!connection) return;
        try {
            const batch = await canvasScriptApi.getGenerationBatch(connection, batchId);
            setGenerationBatch(batch);
            if (batch.images.length) onImagesReady(batch.images);
            if (batch.status === "running") {
                window.setTimeout(() => void pollGeneration(batchId), 3000);
                return;
            }
            setGenerating(false);
            setSelectedTargets(new Set());
            await Promise.all([load(), refreshUserAssets()]);
            message.success(batch.failedCount ? `生成完成：成功 ${batch.successCount} 张，失败 ${batch.failedCount} 张` : `已生成 ${batch.successCount} 张资产图`);
        } catch (error) {
            setGenerating(false);
            message.error(readError(error));
        }
    };

    const filteredAssets = useMemo(() => assets.filter((asset) => assetType === "all" || asset.type === assetType), [assetType, assets]);

    return (
        <div className="flex min-h-0 flex-1 flex-col" style={{ display: active ? undefined : "none" }}>
            {loading && !scriptSet ? (
                <div className="grid flex-1 place-items-center">
                    <Spin />
                </div>
            ) : (
                <Tabs
                    className="script-workspace-tabs min-h-0 flex-1 [&_.ant-tabs-content]:h-full [&_.ant-tabs-content-holder]:min-h-0 [&_.ant-tabs-tabpane]:h-full [&_.ant-tabs-nav]:mb-0 [&_.ant-tabs-nav]:px-5"
                    items={[
                        {
                            key: "episodes",
                            label: "剧集",
                            children: (
                                <EpisodesTab
                                    scriptSet={scriptSet}
                                    activeEpisodeId={activeEpisodeId}
                                    onActiveEpisode={setActiveEpisodeId}
                                    episodeTitle={episodeTitle}
                                    onEpisodeTitle={setEpisodeTitle}
                                    episodeContent={episodeContent}
                                    onEpisodeContent={setEpisodeContent}
                                    onAdd={() => void addEpisode()}
                                    onDelete={(id) => void deleteEpisode(id)}
                                    onSave={() => void saveEpisode()}
                                    onAnalyze={() => void analyzeEpisode()}
                                    saving={saving}
                                    analysis={analysis}
                                    onSettings={setScriptSet}
                                    onSaveSettings={() => void saveSetSettings()}
                                />
                            ),
                        },
                        {
                            key: "assets",
                            label: `资产 ${assets.length}`,
                            children: (
                                <AssetsTab
                                    assets={filteredAssets}
                                    allAssets={assets}
                                    assetType={assetType}
                                    onAssetType={setAssetType}
                                    selected={selectedTargets}
                                    onSelected={setSelectedTargets}
                                    onEdit={setEditingAsset}
                                    onGenerate={() => void generate()}
                                    generating={generating}
                                    generationBatch={generationBatch}
                                    imageBalance={imageBalance}
                                />
                            ),
                        },
                        { key: "pending", label: pending.length ? `待确认 ${pending.length}` : "待确认", children: <PendingTab items={pending} onResolve={(item, decision) => void resolvePending(item, decision)} /> },
                    ]}
                />
            )}
            <AssetEditModal
                asset={editingAsset}
                connectionReady={Boolean(connection)}
                onClose={() => setEditingAsset(null)}
                onSave={async (data) => {
                    if (!connection || !editingAsset) return;
                    try {
                        await canvasScriptApi.updateAsset(connection, editingAsset.id, data);
                        setEditingAsset(null);
                        await load();
                        message.success("资产已保存");
                    } catch (error) {
                        message.error(readError(error));
                    }
                }}
            />
        </div>
    );
}

function EpisodesTab(props: {
    scriptSet: ScriptSet | null;
    activeEpisodeId?: string;
    onActiveEpisode: (id: string) => void;
    episodeTitle: string;
    onEpisodeTitle: (value: string) => void;
    episodeContent: string;
    onEpisodeContent: (value: string) => void;
    onAdd: () => void;
    onDelete: (id: string) => void;
    onSave: () => void;
    onAnalyze: () => void;
    saving: boolean;
    analysis: ScriptAnalysisRun | null;
    onSettings: Dispatch<SetStateAction<ScriptSet | null>>;
    onSaveSettings: () => void;
}) {
    const running = props.analysis?.status === "queued" || props.analysis?.status === "running";
    return (
        <div className="grid h-full min-h-0 grid-cols-[180px_minmax(0,1fr)] max-sm:grid-cols-1">
            <aside className="min-h-0 overflow-y-auto border-r p-3 max-sm:max-h-36 max-sm:border-b max-sm:border-r-0">
                <Button block icon={<Plus className="size-4" />} onClick={props.onAdd}>
                    新建一集
                </Button>
                <div className="mt-2 space-y-1">
                    {props.scriptSet?.episodes.map((episode) => (
                        <button
                            key={episode.id}
                            type="button"
                            onClick={() => props.onActiveEpisode(episode.id)}
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs ${props.activeEpisodeId === episode.id ? "bg-[var(--ant-color-fill-secondary)]" : "hover:bg-[var(--ant-color-fill-tertiary)]"}`}
                        >
                            <span className="min-w-0 flex-1 truncate">{episode.title}</span>
                            <Popconfirm title="删除本集？" description="本集引用会被移除，未再使用的 AI 资产将归档。" onConfirm={() => props.onDelete(episode.id)}>
                                <Trash2 className="size-3.5 text-[var(--ant-color-text-tertiary)] hover:text-red-500" onClick={(event) => event.stopPropagation()} />
                            </Popconfirm>
                        </button>
                    ))}
                </div>
            </aside>
            <main className="flex min-h-0 flex-col gap-3 overflow-y-auto p-5">
                {props.activeEpisodeId ? (
                    <>
                        <Input value={props.episodeTitle} maxLength={120} onChange={(event) => props.onEpisodeTitle(event.target.value)} placeholder="本集标题" />
                        <Input.TextArea value={props.episodeContent} maxLength={30000} showCount onChange={(event) => props.onEpisodeContent(event.target.value)} placeholder="粘贴当前一集的小说或剧本文案" className="min-h-[300px] flex-1 resize-none" />
                        <div className="flex flex-wrap items-center gap-2">
                            <Button icon={<Save className="size-4" />} loading={props.saving} onClick={props.onSave}>
                                保存
                            </Button>
                            <Button type="primary" icon={running ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} disabled={running || !props.episodeContent.trim()} onClick={props.onAnalyze}>
                                {props.scriptSet?.episodes.find((item) => item.id === props.activeEpisodeId)?.currentAnalysisRunId ? "重新分析" : "分析资产"}
                            </Button>
                            {running ? <span className="text-xs text-[var(--ant-color-text-secondary)]">正在提取并匹配跨集资产...</span> : null}
                            {props.analysis?.status === "failed" ? <span className="text-xs text-red-500">{props.analysis.error}</span> : null}
                        </div>
                    </>
                ) : (
                    <Empty description="新建第一集后粘贴文案" />
                )}
                {props.scriptSet ? (
                    <section className="mt-2 border-t pt-4">
                        <div className="mb-3 text-xs font-semibold">统一生图设置</div>
                        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                            <Input value={props.scriptSet.title} onChange={(event) => props.onSettings((current) => (current ? { ...current, title: event.target.value } : current))} placeholder="剧本集名称" />
                            <Select
                                value={props.scriptSet.aspectRatio}
                                onChange={(value) => props.onSettings((current) => (current ? { ...current, aspectRatio: value } : current))}
                                options={["1:1", "3:4", "4:3", "9:16", "16:9"].map((value) => ({ value, label: value }))}
                            />
                            <Select
                                value={props.scriptSet.imageQuality}
                                onChange={(value) => props.onSettings((current) => (current ? { ...current, imageQuality: value } : current))}
                                options={[
                                    { value: "standard", label: "标准质量" },
                                    { value: "medium", label: "中等质量" },
                                    { value: "high", label: "高质量" },
                                ]}
                            />
                            <Input
                                value={props.scriptSet.visualStyle}
                                onChange={(event) => props.onSettings((current) => (current ? { ...current, visualStyle: event.target.value } : current))}
                                placeholder="统一画风，例如：电影感写实、东方奇幻、柔和自然光"
                            />
                        </div>
                        <Button className="mt-3" size="small" onClick={props.onSaveSettings}>
                            保存设置
                        </Button>
                    </section>
                ) : null}
            </main>
        </div>
    );
}

function AssetsTab({
    assets,
    allAssets,
    assetType,
    onAssetType,
    selected,
    onSelected,
    onEdit,
    onGenerate,
    generating,
    generationBatch,
    imageBalance,
}: {
    assets: ScriptAsset[];
    allAssets: ScriptAsset[];
    assetType: ScriptAssetType | "all";
    onAssetType: (value: ScriptAssetType | "all") => void;
    selected: Set<string>;
    onSelected: (value: Set<string>) => void;
    onEdit: (asset: ScriptAsset) => void;
    onGenerate: () => void;
    generating: boolean;
    generationBatch: ScriptGenerationBatch | null;
    imageBalance: number;
}) {
    const totalTargets = allAssets.reduce((sum, asset) => sum + 1 + asset.variants.length, 0);
    const missingTargets = allAssets.flatMap((asset) => [...(!asset.image?.imageUrl ? [`${asset.id}:`] : []), ...asset.variants.filter((variant) => !variant.image?.imageUrl).map((variant) => `${asset.id}:${variant.id}`)]);
    const visibleTargets = assets.flatMap((asset) => [`${asset.id}:`, ...asset.variants.map((variant) => `${asset.id}:${variant.id}`)]);
    const toggle = (key: string, checked: boolean) => {
        const next = new Set(selected);
        checked ? next.add(key) : next.delete(key);
        onSelected(next);
    };
    const generationFor = (assetId: string, variantId?: string) => generationBatch?.images.find((image) => image.assetId === assetId && (image.variantId || undefined) === variantId);
    const statusTag = (image?: ScriptGenerationImage) => {
        if (!image) return null;
        const status = image.status.toLowerCase();
        const label = status === "success" ? "成功" : ["failed", "error", "canceled"].includes(status) ? "失败" : "生成中";
        return <Tag color={label === "成功" ? "success" : label === "失败" ? "error" : "processing"}>{label}</Tag>;
    };
    const completed = generationBatch ? generationBatch.successCount + generationBatch.failedCount : 0;
    const progressPercent = generationBatch?.requestedCount ? Math.round((completed / generationBatch.requestedCount) * 100) : 0;
    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-5 py-3">
                <Select value={assetType} onChange={onAssetType} className="w-28" options={[{ value: "all", label: "全部资产" }, ...Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))]} />
                <span className="text-xs text-[var(--ant-color-text-secondary)]">
                    已选 {selected.size} / {totalTargets}
                </span>
                <span className="text-xs text-[var(--ant-color-text-tertiary)]">图片额度 {imageBalance} 张</span>
                <div className="flex items-center gap-1 max-sm:w-full">
                    <Button size="small" onClick={() => onSelected(new Set(missingTargets))} disabled={!missingTargets.length}>
                        只选无图
                    </Button>
                    <Button size="small" onClick={() => onSelected(new Set(visibleTargets))} disabled={!visibleTargets.length}>
                        全选当前分类
                    </Button>
                    <Button size="small" onClick={() => onSelected(new Set())} disabled={!selected.size}>
                        清空选择
                    </Button>
                </div>
                <Button className="ml-auto max-sm:ml-0" type="primary" icon={generating ? <LoaderCircle className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} disabled={!selected.size || generating} onClick={onGenerate}>
                    生成图片
                </Button>
            </div>
            {generationBatch ? (
                <div className="mx-5 mt-3 shrink-0 rounded-md border px-3 py-3">
                    <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium">本批次生成进度</span>
                        <span className="text-[var(--ant-color-text-secondary)]">
                            {completed}/{generationBatch.requestedCount} 已完成 · 成功 {generationBatch.successCount} · 失败 {generationBatch.failedCount}
                        </span>
                    </div>
                    <Progress className="mt-2" percent={progressPercent} size="small" status={generationBatch.failedCount && completed === generationBatch.requestedCount ? "exception" : generationBatch.status === "success" ? "success" : "active"} />
                    <div className="mt-1 text-[11px] text-[var(--ant-color-text-tertiary)]">每个资产/变体对应一个图片任务和一张图片额度；关闭工作区后任务仍会在后台继续。</div>
                </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-5">
                {assets.length ? (
                    assets.map((asset) => (
                        <div key={asset.id} className="flex gap-3 border-b py-4">
                            <Checkbox checked={selected.has(`${asset.id}:`)} onChange={(event) => toggle(`${asset.id}:`, event.target.checked)} />
                            <AssetThumb imageUrl={asset.image?.imageUrl} type={asset.type} />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="truncate text-sm font-semibold">{asset.name}</span>
                                    <Tag bordered={false}>{TYPE_LABEL[asset.type]}</Tag>
                                    {statusTag(generationFor(asset.id))}
                                    <span className="text-xs text-[var(--ant-color-text-tertiary)]">出现 {asset.mentionCount} 集</span>
                                </div>
                                <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--ant-color-text-secondary)]">{asset.visualDescription || "暂无视觉描述"}</p>
                                {asset.aliases.length ? <div className="mt-1 text-xs text-[var(--ant-color-text-tertiary)]">别名：{asset.aliases.join("、")}</div> : null}
                                {asset.variants.map((variant) => (
                                    <label key={variant.id} className="mt-2 flex items-center gap-2 rounded-md bg-[var(--ant-color-fill-tertiary)] px-2 py-2 text-xs">
                                        <Checkbox checked={selected.has(`${asset.id}:${variant.id}`)} onChange={(event) => toggle(`${asset.id}:${variant.id}`, event.target.checked)} />
                                        <span className="min-w-0 flex-1 truncate">变体：{variant.name}</span>
                                        {statusTag(generationFor(asset.id, variant.id))}
                                        {variant.image?.imageUrl ? <img src={variant.image.imageUrl} className="size-8 rounded object-cover" alt="" /> : null}
                                    </label>
                                ))}
                            </div>
                            <Button size="small" onClick={() => onEdit(asset)}>
                                编辑
                            </Button>
                        </div>
                    ))
                ) : (
                    <Empty className="mt-16" description="分析剧集后将在这里形成跨集资产库" />
                )}
            </div>
        </div>
    );
}

function PendingTab({ items, onResolve }: { items: ScriptPendingMention[]; onResolve: (item: ScriptPendingMention, decision: "reuse" | "variant" | "new") => void }) {
    return (
        <div className="h-full overflow-y-auto px-5 py-2">
            {items.length ? (
                items.map((item) => (
                    <div key={item.id} className="border-b py-4">
                        <div className="mb-3 flex items-center gap-2">
                            <Tag color="gold">疑似重复</Tag>
                            <span className="text-sm font-semibold">{item.extractedName}</span>
                            <span className="text-xs text-[var(--ant-color-text-secondary)]">
                                {item.episodeTitle} · 置信度 {Math.round(item.confidence * 100)}%
                            </span>
                        </div>
                        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                            <div className="rounded-md border p-3">
                                <div className="mb-2 text-xs font-semibold">本集提取</div>
                                <p className="text-xs leading-5 text-[var(--ant-color-text-secondary)]">{String(item.extracted.visualDescription || item.sourceExcerpt || "暂无描述")}</p>
                            </div>
                            <div className="rounded-md border p-3">
                                <div className="mb-2 text-xs font-semibold">已有资产：{item.suggestedAsset?.name || "未找到候选"}</div>
                                <p className="text-xs leading-5 text-[var(--ant-color-text-secondary)]">{item.suggestedAsset?.visualDescription || "暂无描述"}</p>
                            </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <Button type="primary" disabled={!item.suggestedAsset} onClick={() => onResolve(item, "reuse")}>
                                复用已有
                            </Button>
                            <Button disabled={!item.suggestedAsset} onClick={() => onResolve(item, "variant")}>
                                作为变体
                            </Button>
                            <Button onClick={() => onResolve(item, "new")}>新建资产</Button>
                        </div>
                    </div>
                ))
            ) : (
                <Empty className="mt-16" description="没有需要人工确认的重复资产" />
            )}
        </div>
    );
}

function AssetEditModal({ asset, connectionReady, onClose, onSave }: { asset: ScriptAsset | null; connectionReady: boolean; onClose: () => void; onSave: (data: Partial<ScriptAsset>) => Promise<void> }) {
    const [draft, setDraft] = useState<ScriptAsset | null>(asset);
    useEffect(() => setDraft(asset), [asset]);
    return (
        <Modal
            open={Boolean(asset)}
            title="编辑规范资产"
            onCancel={onClose}
            onOk={() => draft && void onSave({ name: draft.name, aliases: draft.aliases, visualDescription: draft.visualDescription, imagePrompt: draft.imagePrompt })}
            okButtonProps={{ disabled: !connectionReady || !draft?.name.trim() }}
            destroyOnHidden
        >
            {draft ? (
                <div className="space-y-3">
                    <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="资产名称" />
                    <Input
                        value={draft.aliases.join("、")}
                        onChange={(event) =>
                            setDraft({
                                ...draft,
                                aliases: event.target.value
                                    .split(/[、,，]/)
                                    .map((item) => item.trim())
                                    .filter(Boolean),
                            })
                        }
                        placeholder="别名，用顿号分隔"
                    />
                    <Input.TextArea rows={4} value={draft.visualDescription} onChange={(event) => setDraft({ ...draft, visualDescription: event.target.value })} placeholder="稳定视觉描述" />
                    <Input.TextArea rows={4} value={draft.imagePrompt} onChange={(event) => setDraft({ ...draft, imagePrompt: event.target.value })} placeholder="生图提示词" />
                </div>
            ) : null}
        </Modal>
    );
}

function AssetThumb({ imageUrl, type }: { imageUrl?: string; type: ScriptAssetType }) {
    if (imageUrl) return <img src={imageUrl} className="size-16 shrink-0 rounded-md object-cover" alt="" />;
    const Icon = type === "character" ? UsersRound : type === "scene" ? Warehouse : Boxes;
    return (
        <span className="grid size-16 shrink-0 place-items-center rounded-md bg-[var(--ant-color-fill-secondary)] text-[var(--ant-color-text-tertiary)]">
            <Icon className="size-5" />
        </span>
    );
}

function readError(error: unknown) {
    const value = error as { response?: { data?: { message?: string } }; message?: string };
    return value.response?.data?.message || value.message || "请求失败";
}
