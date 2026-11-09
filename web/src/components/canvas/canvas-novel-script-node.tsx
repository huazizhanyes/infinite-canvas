import { useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from "react";
import axios from "axios";
import { App, Button } from "antd";
import { BookOpenText, Square, Wand2 } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { canvasTextApi } from "@/services/api/canvas-text";
import { useUserStore } from "@/stores/use-user-store";
import { useEffectiveConfig, modelOptionName } from "@/stores/use-config-store";
import { buildNovelScriptInput, buildNovelScriptResultOps, NOVEL_SCRIPT_MAX_SOURCE, novelEstimateSeconds, novelWordCount } from "@/lib/canvas/novel-script";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

// 文本模型计费信息（与 /drama 的 TextModelPicker 同源：GET /text-billing/models）
type TextBillingModel = {
    model_key: string;
    pricing_mode: "free" | "per_call";
    price_yuan: number;
    free: boolean;
    is_default?: boolean;
};

// 「小说改剧本」节点：粘贴小说原文 → AI 一键改写 → 每次生成新建一个独立的「剧本」节点存结果。
// 改写指令与后端 drama-studio（script_rewriter agent + rewrite_to_screenplay）1:1 对齐，走画布 /v1/responses 通道（一次性返回）。
export function CanvasNovelScriptNode({ ctx }: { ctx: CanvasNodeContext }) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const connection = useUserStore((state) => state.connection);
    const controllerRef = useRef<AbortController | null>(null);
    const [billing, setBilling] = useState<Record<string, TextBillingModel>>({});
    // 拉取文本模型免费/价格标记（静默失败，不影响选择）
    useEffect(() => {
        if (!connection?.apiBaseUrl || !connection.token) return;
        let cancelled = false;
        const load = () => {
            axios
                .get(`${connection.apiBaseUrl.replace(/\/+$/, "")}/text-billing/models`, { headers: { Authorization: `Bearer ${connection.token}` } })
                .then((response) => {
                    const payload = response?.data?.data ?? response?.data;
                    const items: TextBillingModel[] = payload?.items || [];
                    if (cancelled) return;
                    setBilling(Object.fromEntries(items.map((item) => [String(item.model_key || "").toLowerCase(), item])));
                })
                .catch(() => undefined);
        };
        load();
        return () => {
            cancelled = true;
        };
    }, [connection?.apiBaseUrl, connection?.token]);

    const billingBadge = (value: string) => {
        const info = billing[modelOptionName(value).trim().toLowerCase()];
        if (!info) return null;
        return (
            <span className="flex shrink-0 items-center gap-1">
                {info.is_default ? <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] leading-none text-sky-300">默认</span> : null}
                {info.free || info.pricing_mode === "free" ? (
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] leading-none text-emerald-400">
                        免费
                    </span>
                ) : Number(info.price_yuan) > 0 ? (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] leading-none text-amber-400">¥{Number(info.price_yuan).toFixed(2)}/次</span>
                ) : null}
            </span>
        );
    };

    const rawText = ctx.node.metadata?.novelScriptRawText || "";
    const status = ctx.node.metadata?.novelScriptStatus || "idle";
    const error = ctx.node.metadata?.novelScriptError || "";
    const generating = status === "generating";
    const wordCount = novelWordCount(rawText);
    const estimateSeconds = novelEstimateSeconds(wordCount);

    // 节点卸载时中断进行中的请求
    useEffect(() => () => controllerRef.current?.abort(), []);

    const updateRawText = (value: string) => ctx.updateMetadata({ novelScriptRawText: value });

    const abort = () => {
        controllerRef.current?.abort();
        controllerRef.current = null;
        ctx.updateMetadata({ novelScriptStatus: "idle" });
    };

    const generate = async () => {
        const source = rawText.trim();
        if (!source) {
            message.warning("请先粘贴小说原文");
            return;
        }
        if (!connection) {
            message.warning("请先登录后再生成剧本");
            return;
        }
        if (ctx.node.metadata?.novelScriptStatus === "generating") return;
        const controller = new AbortController();
        controllerRef.current = controller;
        ctx.updateMetadata({ novelScriptStatus: "generating", novelScriptError: undefined });
        try {
            const model = ctx.node.metadata?.novelScriptModel || config.textModel;
            const completion = await canvasTextApi.complete(
                connection,
                {
                    requestId: `${ctx.node.id}-${Date.now()}`,
                    input: buildNovelScriptInput(source),
                    model: modelOptionName(model),
                    operation: "custom",
                    sourceNodeId: ctx.node.id,
                },
                controller.signal,
            );
            const script = completion.outputText.trim();
            if (!script) throw new Error("模型未返回剧本内容，请重试");
            ctx.applyOps(buildNovelScriptResultOps({ sourceNode: ctx.node, script, nodes: ctx.getNodes() }));
            ctx.updateMetadata({ novelScriptStatus: "idle", novelScriptError: undefined });
            message.success("已生成剧本节点");
        } catch (err) {
            if (controller.signal.aborted) {
                ctx.updateMetadata({ novelScriptStatus: "idle" });
                return;
            }
            const errorMessage = err instanceof Error ? err.message : "生成失败，请重试";
            ctx.updateMetadata({ novelScriptStatus: "error", novelScriptError: errorMessage });
        } finally {
            if (controllerRef.current === controller) controllerRef.current = null;
        }
    };

    const stop = (event: SyntheticEvent) => event.stopPropagation();
    const model = ctx.node.metadata?.novelScriptModel || config.textModel;
    const statusText = generating
        ? "正在改写剧本…"
        : status === "error"
            ? "生成失败"
            : wordCount
                ? `约 ${estimateSeconds} 秒成片 · 每次生成新建「剧本」节点`
                : "粘贴小说原文（最多 6000 字）";

    return (
        <div className="flex h-full w-full flex-col overflow-hidden" data-canvas-no-zoom style={{ color: ctx.theme.node.text, background: ctx.theme.node.panel } as CSSProperties}>
            <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.toolbar.panel }}>
                <span className="grid size-7 shrink-0 place-items-center rounded-md" style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.toolbar.activeText }}>
                    <BookOpenText className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold">小说改剧本</div>
                    <div className="truncate text-[10px]" style={{ color: status === "error" ? "#ef4444" : ctx.theme.node.muted }}>{statusText}</div>
                </div>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-1 px-3 py-2" onMouseDown={stop} onPointerDown={stop} onDoubleClick={stop} onWheel={stop}>
                <div className="flex items-center justify-between text-[10px]" style={{ color: ctx.theme.node.muted }}>
                    <span>小说原文</span>
                    <span>{wordCount.toLocaleString()} / {NOVEL_SCRIPT_MAX_SOURCE} 字</span>
                </div>
                <textarea
                    value={rawText}
                    placeholder="粘贴小说原文（最多 6000 字），点击下方「生成剧本」改写为格式化剧本"
                    maxLength={NOVEL_SCRIPT_MAX_SOURCE}
                    disabled={generating}
                    className="thin-scrollbar min-h-0 w-full flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-[12px] leading-5 outline-none transition-colors focus:border-sky-500/60 disabled:opacity-60"
                    style={{ borderColor: ctx.theme.node.stroke, color: ctx.theme.node.text, background: ctx.theme.node.fill }}
                    onChange={(event) => updateRawText(event.target.value)}
                />
                {status === "error" && error ? (
                    <div className="shrink-0 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-400">{error}</div>
                ) : null}
            </div>

            <footer className="flex shrink-0 items-center gap-2 border-t px-3 py-2" style={{ borderColor: ctx.theme.node.stroke, background: ctx.theme.toolbar.panel }}>
                <ModelPicker
                    config={config}
                    value={model}
                    onChange={(value) => ctx.updateMetadata({ novelScriptModel: value })}
                    capability="text"
                    className="!h-8 !min-w-0 !max-w-[240px] flex-1 !px-2 !text-xs"
                    optionBadge={billingBadge}
                />
                {generating ? (
                    <Button size="small" danger icon={<Square className="size-3" />} onMouseDown={stop} onClick={abort}>
                        中断
                    </Button>
                ) : (
                    <Button type="primary" size="small" icon={<Wand2 className="size-3.5" />} disabled={!rawText.trim() || !connection} onMouseDown={stop} onClick={() => void generate()}>
                        生成剧本
                    </Button>
                )}
            </footer>
        </div>
    );
}
