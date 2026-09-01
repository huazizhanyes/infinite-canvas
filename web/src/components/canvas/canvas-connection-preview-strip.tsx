import { Popover } from "antd";
import { Image as ImageIcon, Music2, Video, X } from "lucide-react";

import type { CanvasConnectionPreview } from "@/lib/canvas/canvas-connection-previews";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasConnectionPreviewStripProps = {
    items: CanvasConnectionPreview[];
    onMention: (item: CanvasConnectionPreview) => void;
    onRemove: (item: CanvasConnectionPreview) => void;
    onFocusNode?: (nodeId: string) => void;
};

export function CanvasConnectionPreviewStrip({ items, onMention, onRemove, onFocusNode }: CanvasConnectionPreviewStripProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!items.length) return null;

    return (
        <div className="thin-scrollbar flex min-h-14 max-w-full items-center gap-2 overflow-x-auto overflow-y-hidden pb-2 pr-1" data-canvas-no-zoom>
            {items.map((item) => (
                <Popover
                    key={item.connectionId}
                    trigger="hover"
                    placement="top"
                    mouseEnterDelay={0.12}
                    mouseLeaveDelay={0.08}
                    content={<ConnectionPreviewMedia item={item} large />}
                    styles={{ content: { padding: 6 }, container: { background: theme.node.panel, border: `1px solid ${theme.node.stroke}` } }}
                >
                    <div
                        data-connection-preview-id={item.connectionId}
                        className="group relative size-12 shrink-0 cursor-zoom-in overflow-hidden rounded-[7px] border transition-colors"
                        style={{ background: theme.node.fill, borderColor: theme.node.stroke }}
                        title={item.title || item.label}
                        onDoubleClick={(event) => {
                            event.stopPropagation();
                            onFocusNode?.(item.nodeId);
                        }}
                    >
                        <ConnectionPreviewMedia item={item} />
                        <span className="pointer-events-none absolute left-1 top-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-black/75 px-1 py-0.5 text-[9px] font-semibold leading-none text-white transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                            {item.label}
                        </span>
                        <button
                            type="button"
                            className="absolute right-px top-px grid size-3.5 place-items-center rounded-full bg-black/75 text-white opacity-0 transition hover:bg-red-500 group-hover:opacity-100 group-focus-within:opacity-100"
                            title="删除连接"
                            aria-label={`删除${item.label}连接`}
                            onMouseDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}
                            onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}
                            onClick={(event) => {
                                event.stopPropagation();
                                onRemove(item);
                            }}
                        >
                            <X className="size-2" />
                        </button>
                        <button
                            type="button"
                            className="absolute bottom-px right-px grid size-3.5 place-items-center rounded-full bg-black/75 text-[10px] font-semibold leading-none text-white transition hover:bg-blue-500"
                            title={`引用${item.label}`}
                            aria-label={`引用${item.label}`}
                            onMouseDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}
                            onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}
                            onClick={(event) => {
                                event.stopPropagation();
                                onMention(item);
                            }}
                        >
                            @
                        </button>
                    </div>
                </Popover>
            ))}
        </div>
    );
}

function ConnectionPreviewMedia({ item, large = false }: { item: CanvasConnectionPreview; large?: boolean }) {
    const className = large ? "max-h-64 max-w-80 rounded-md object-contain" : "size-full object-cover";
    if (item.kind === "image") return <img src={item.previewUrl} alt={item.title || item.label} className={className} />;
    if (item.kind === "video" && item.previewUrl) return <video src={item.previewUrl} className={`${className} bg-black`} muted autoPlay={large} loop={large} playsInline preload="metadata" />;
    return (
        <span className={`grid ${large ? "h-28 w-56" : "size-full"} place-items-center bg-blue-500/10`}>
            <span className="flex flex-col items-center gap-2 px-3 text-center">
                {item.kind === "audio" ? <Music2 className={large ? "size-8 text-blue-400" : "size-5 text-blue-400"} /> : item.kind === "video" ? <Video className="size-5 opacity-45" /> : <ImageIcon className="size-5 opacity-45" />}
                {large && item.kind === "audio" ? <span className="max-w-48 truncate text-xs opacity-70">{item.title || item.label}</span> : null}
            </span>
        </span>
    );
}
