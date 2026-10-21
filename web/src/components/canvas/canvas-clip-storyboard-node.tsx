import { useMemo, useRef, type CSSProperties, type SyntheticEvent } from "react";
import { App, Button } from "antd";
import { Clapperboard, Scissors, Upload } from "lucide-react";

import { videoDurationOptions } from "@/lib/canvas/asset-storyboard";
import { buildClipStoryboardOps, getClipStoryboardAssetPool, matchClipStoryboardClips, parseClipStoryboardScript } from "@/lib/canvas/clip-storyboard";
import { useEffectiveConfig, videoCapabilitiesOf } from "@/stores/use-config-store";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

const SCRIPT_PLACEHOLDER = `粘贴分镜脚本，下面几种 Clip 头都支持：

**Clip S01-01｜12s**
### Clip S12-02｜标题｜约5秒
## S01 场景
### Clip 01｜标题｜12秒

资产声明支持：
**资产：**@角色、@场景
或任意【…】段落里的“名称 → @”资产行（含身高参考）；顶部 ## 资产全局映射表 / ## 声音参考锁定 会自动用于别名解析和配音匹配。

每个 Clip 生成一个视频节点；优先完全同名，找不到时按别名表和名称包含关系模糊匹配，多个候选取连线顺序第一个。`;

export function CanvasClipStoryboardNode({ ctx }: { ctx: CanvasNodeContext }) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const script = ctx.node.metadata?.clipStoryboardScript || "";
    const parsed = useMemo(() => parseClipStoryboardScript(script), [script]);
    const pool = getClipStoryboardAssetPool(ctx.node, ctx.getNodes(), ctx.getConnections());
    const durationOptions = useMemo(() => videoDurationOptions(videoCapabilitiesOf(config, config.videoModel)?.duration), [config]);
    const matches = matchClipStoryboardClips(parsed.clips, pool, { durationOptions, assetTable: parsed.assetTable, voiceNames: parsed.voiceNames, globalRules: parsed.globalRules });
    const poolImages = pool.filter((node) => node.type === CanvasNodeType.Image || node.type === CanvasNodeType.ScriptAsset).length;
    const poolAudios = pool.filter((node) => node.type === CanvasNodeType.Audio).length;
    const videoCount = ctx.getNodes().filter((node) => node.type === CanvasNodeType.Video && node.metadata?.clipStoryboardSourceId === ctx.node.id).length;
    const status = !script.trim()
        ? `等待粘贴脚本 · 素材池 ${poolImages} 图 / ${poolAudios} 音`
        : parsed.error || `${parsed.clips.length} 个分镜 · 素材池 ${poolImages} 图 / ${poolAudios} 音`;

    const updateScript = (value: string) => ctx.updateMetadata({ clipStoryboardScript: value });

    const importScript = async (file?: File) => {
        if (!file) return;
        try {
            const text = await file.text();
            if (!text.trim()) {
                message.warning("文件内容为空");
                return;
            }
            updateScript(text);
            message.success(`已导入 ${file.name}`);
        } catch {
            message.error("文件读取失败，请换一个文件");
        }
    };

    const split = () => {
        const currentParsed = parseClipStoryboardScript(script);
        const currentPool = getClipStoryboardAssetPool(ctx.node, ctx.getNodes(), ctx.getConnections());
        const currentMatches = matchClipStoryboardClips(currentParsed.clips, currentPool, { durationOptions, assetTable: currentParsed.assetTable, voiceNames: currentParsed.voiceNames, globalRules: currentParsed.globalRules });
        if (!currentMatches.length) {
            message.warning(currentParsed.error || "没有可拆解的分镜");
            return;
        }
        const currentVideoCount = ctx.getNodes().filter((node) => node.type === CanvasNodeType.Video && node.metadata?.clipStoryboardSourceId === ctx.node.id).length;
        const notices = currentMatches.reduce((sum, item) => sum + item.unmatched.length + item.warnings.length, 0);
        const fuzzyCount = currentMatches.reduce((sum, item) => sum + item.fuzzy.length, 0);
        const aliasCount = currentMatches.reduce((sum, item) => sum + item.aliases.length, 0);
        ctx.applyOps(buildClipStoryboardOps({ storyboard: ctx.node, matches: currentMatches, nodes: ctx.getNodes(), connections: ctx.getConnections(), videoModel: config.videoModel }));
        message.success(`${currentVideoCount ? "已更新" : "已生成"} ${currentMatches.length} 个视频节点${aliasCount ? `，${aliasCount} 条别名映射` : ""}${fuzzyCount ? `，${fuzzyCount} 条模糊匹配` : ""}${notices ? `，${notices} 条素材提示` : ""}`);
    };

    const stopCanvasInteraction = (event: SyntheticEvent) => event.stopPropagation();

    return (
        <div className="flex h-full w-full flex-col overflow-hidden" data-canvas-no-zoom style={{ color: ctx.theme.node.text, background: ctx.theme.node.panel } as CSSProperties}>
            <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.toolbar.panel }}>
                <span className="grid size-7 shrink-0 place-items-center rounded-md" style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.toolbar.activeText }}><Clapperboard className="size-4" /></span>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold">分镜拆解</div>
                    <div className="truncate text-[10px]" style={{ color: parsed.error && script.trim() ? "#ef4444" : ctx.theme.node.muted }}>{status}</div>
                </div>
                <Button size="small" type="text" icon={<Upload className="size-3.5" />} onMouseDown={stopCanvasInteraction} onClick={() => fileInputRef.current?.click()}>导入</Button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".md,.markdown,.txt,text/plain,text/markdown"
                    className="hidden"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        void importScript(file);
                    }}
                />
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2" onMouseDown={stopCanvasInteraction} onPointerDown={stopCanvasInteraction} onDoubleClick={stopCanvasInteraction} onWheel={stopCanvasInteraction}>
                <div className="flex items-center justify-between text-[10px]" style={{ color: ctx.theme.node.muted }}>
                    <span>分镜脚本（Markdown / 纯文本）</span>
                    <span>{script.length.toLocaleString()} 字</span>
                </div>
                <textarea
                    value={script}
                    placeholder={SCRIPT_PLACEHOLDER}
                    className="thin-scrollbar min-h-0 w-full flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-[12px] leading-5 outline-none transition-colors focus:border-sky-500/60"
                    style={{ borderColor: ctx.theme.node.stroke, color: ctx.theme.node.text, background: ctx.theme.node.fill }}
                    onChange={(event) => updateScript(event.target.value)}
                />
            </div>

            {matches.length ? (
                <div className="thin-scrollbar max-h-44 shrink-0 overflow-y-auto border-t px-3 py-2" style={{ borderColor: ctx.theme.node.stroke }} onPointerDown={stopCanvasInteraction} onWheel={stopCanvasInteraction}>
                    <div className="grid gap-1">
                        {matches.map((match, index) => (
                            <details key={`${match.clip.code}:${index}`} className="rounded border px-2 py-1" style={{ borderColor: ctx.theme.node.stroke }}>
                                <summary className="flex cursor-pointer items-center gap-2 text-[11px]">
                                    <span className="min-w-0 flex-1 truncate font-semibold" title={`${match.clip.code}${match.clip.title ? ` · ${match.clip.title}` : ""}`}>{match.clip.code}{match.clip.title ? ` · ${match.clip.title}` : ""}</span>
                                    <span className="shrink-0" style={{ color: ctx.theme.node.muted }}>{match.clip.durationSec}s</span>
                                    <span className="shrink-0" style={{ color: ctx.theme.node.muted }}>{match.images.length} 图{match.audios.length ? ` / ${match.audios.length} 音` : ""}</span>
                                    {match.unmatched.length ? <span className="shrink-0 text-red-400">{match.unmatched.length} 未匹配</span> : <span className="shrink-0 text-emerald-400">已匹配</span>}
                                    {match.aliases.length ? <span className="shrink-0 text-violet-400">{match.aliases.length} 别名</span> : null}
                                    {match.fuzzy.length ? <span className="shrink-0 text-sky-400">{match.fuzzy.length} 模糊</span> : null}
                                    {match.warnings.length ? <span className="shrink-0 text-amber-400">{match.warnings.length} 提示</span> : null}
                                </summary>
                                <div className="mt-1 space-y-1 text-[10px]" style={{ color: ctx.theme.node.muted }}>
                                    {match.aliases.map((item) => <div key={`alias:${item.kind}:${item.name}`} className="text-violet-400">别名映射：{item.name} → {item.nodeTitle}</div>)}
                                    {match.fuzzy.map((item) => <div key={`fuzzy:${item.kind}:${item.name}`} className="text-sky-400">模糊匹配：{item.name} → {item.nodeTitle}</div>)}
                                    {match.unmatched.map((item) => <div key={`${item.kind}:${item.name}`} className="text-red-400">未匹配{item.kind === "audio" ? "声音" : "图片"}：{item.name}</div>)}
                                    {match.warnings.map((warning) => <div key={warning} className="text-amber-400">{warning}</div>)}
                                    <pre className="thin-scrollbar max-h-40 overflow-auto whitespace-pre-wrap font-sans text-[10px] leading-4">{match.prompt}</pre>
                                </div>
                            </details>
                        ))}
                    </div>
                </div>
            ) : null}

            <footer className="flex shrink-0 items-center gap-2 border-t px-3 py-2" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.toolbar.panel }}>
                <span className="min-w-0 flex-1 truncate text-[10px]" style={{ color: ctx.theme.node.muted }}>
                    {videoCount ? `已有 ${videoCount} 个视频节点，再次拆解会更新提示词` : "每个 Clip 生成一个视频节点，不自动生成视频"}
                </span>
                <Button type="primary" size="small" icon={<Scissors className="size-3.5" />} disabled={!matches.length} onMouseDown={stopCanvasInteraction} onClick={split}>
                    {videoCount ? "更新视频节点" : "拆解并生成视频节点"}
                </Button>
            </footer>
        </div>
    );
}
