import { type CSSProperties, type SyntheticEvent } from "react";
import { ScrollText } from "lucide-react";

import { NOVEL_SCRIPT_MAX_SCRIPT, novelSceneCount, novelWordCount } from "@/lib/canvas/novel-script";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

// 「剧本」节点：专门存储小说改剧本的产出，单栏可编辑，独立类型不复用文本框。
export function CanvasScriptResultNode({ ctx }: { ctx: CanvasNodeContext }) {
    const script = ctx.node.metadata?.scriptContent || "";
    const wordCount = novelWordCount(script);
    const sceneCount = novelSceneCount(script);
    const stop = (event: SyntheticEvent) => event.stopPropagation();

    return (
        <div className="flex h-full w-full flex-col overflow-hidden" data-canvas-no-zoom style={{ color: ctx.theme.node.text, background: ctx.theme.node.panel } as CSSProperties}>
            <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.toolbar.panel }}>
                <span className="grid size-7 shrink-0 place-items-center rounded-md" style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.toolbar.activeText }}>
                    <ScrollText className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold">剧本</div>
                    <div className="truncate text-[10px]" style={{ color: ctx.theme.node.muted }}>{sceneCount ? `${sceneCount} 个场景 · 可直接编辑` : "等待剧本内容"}</div>
                </div>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-1 px-3 py-2" onMouseDown={stop} onPointerDown={stop} onDoubleClick={stop} onWheel={stop}>
                <textarea
                    value={script}
                    placeholder={`格式化剧本，支持直接编辑：\n## S01 | 内景 · 地点 | 日 / 动作 / 角色：（表情）台词`}
                    maxLength={NOVEL_SCRIPT_MAX_SCRIPT}
                    className="thin-scrollbar min-h-0 w-full flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-[12px] leading-5 outline-none transition-colors focus:border-sky-500/60"
                    style={{ borderColor: ctx.theme.node.stroke, color: ctx.theme.node.text, background: ctx.theme.node.fill }}
                    onChange={(event) => ctx.updateMetadata({ scriptContent: event.target.value })}
                />
            </div>

            <footer className="flex shrink-0 items-center gap-2 border-t px-3 py-2" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.toolbar.panel }}>
                <span className="min-w-0 flex-1 truncate text-[10px]" style={{ color: ctx.theme.node.muted }}>
                    {wordCount.toLocaleString()} 字 · {sceneCount} 个场景（上限 {NOVEL_SCRIPT_MAX_SCRIPT} 字）
                </span>
            </footer>
        </div>
    );
}
