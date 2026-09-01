import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ForwardedRef, MouseEvent, PointerEvent, ReactNode, TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Button, Modal } from "antd";
import { ChevronRight, FileText, FolderOpen, Image as ImageIcon, Maximize2, Music2, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { isImeComposing, isPlainEnterKey } from "@/lib/keyboard-event";
import { useThemeStore } from "@/stores/use-theme-store";
import { parseCanvasResourceMentionTokens, serializeCanvasResourceMention, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

type MentionState = {
    start: number;
    end: number;
    query: string;
};

export type CanvasMentionInsertRequest = {
    nonce: number;
    reference: CanvasResourceReference;
};

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
    value: string;
    references: CanvasResourceReference[];
    onChange: (value: string) => void;
    onSubmit?: () => void;
    containerClassName?: string;
    highlightLabels?: boolean;
    expandable?: boolean;
    expandTitle?: string;
    richMentions?: boolean;
    placeholderClassName?: string;
    header?: ReactNode;
    expandedFooter?: ReactNode;
    mentionInsertRequest?: CanvasMentionInsertRequest | null;
};

export const CanvasResourceMentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function CanvasResourceMentionTextarea(props, forwardedRef) {
    if (props.richMentions) return <CanvasRichMentionEditor {...props} />;
    return <CanvasTextareaMentionEditor {...props} forwardedRef={forwardedRef} />;
});

function CanvasTextareaMentionEditor({ value, references, onChange, onSubmit, onKeyDown, className, containerClassName, style, highlightLabels = true, expandable = true, expandTitle = "编辑内容", richMentions: _richMentions, header: _header, expandedFooter: _expandedFooter, mentionInsertRequest, placeholder, forwardedRef, ...props }: Props & { forwardedRef: ForwardedRef<HTMLTextAreaElement> }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [hasSelection, setHasSelection] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);
    const lastHandledMentionRequestRef = useRef(0);
    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = mention.query.trim().toLowerCase();
        const activeReferences = references.filter((item) => item.active);
        if (!query) return activeReferences;
        return activeReferences.filter((item) => `${item.label} ${item.title} ${item.kind} ${item.text || ""}`.toLowerCase().includes(query));
    }, [mention, references]);
    const activeLabels = useMemo(() => (highlightLabels ? Array.from(new Set(references.filter((item) => item.active).map((item) => item.label))).sort((a, b) => b.length - a.length) : []), [highlightLabels, references]);
    const updateValue = (next: string, selectionStart?: number) => {
        if (typeof selectionStart === "number") pendingSelectionRef.current = { start: selectionStart, end: selectionStart };
        onChange(next);
    };

    useLayoutEffect(() => {
        const selection = pendingSelectionRef.current;
        const textarea = textareaRef.current;
        if (!selection || !textarea) return;
        pendingSelectionRef.current = null;
        textarea.focus();
        textarea.setSelectionRange(Math.min(selection.start, value.length), Math.min(selection.end, value.length));
    }, [value]);

    useLayoutEffect(() => {
        const textarea = textareaRef.current;
        if (!mentionInsertRequest || !textarea || !isFocused || lastHandledMentionRequestRef.current === mentionInsertRequest.nonce) return;
        lastHandledMentionRequestRef.current = mentionInsertRequest.nonce;
        const start = textarea.selectionStart ?? value.length;
        const end = textarea.selectionEnd ?? start;
        const insertText = `@${mentionInsertRequest.reference.label} `;
        updateValue(`${value.slice(0, start)}${insertText}${value.slice(end)}`, start + insertText.length);
    }, [isFocused, mentionInsertRequest, value]);

    const closeMention = () => {
        setMention(null);
        setActiveIndex(0);
    };

    const syncMention = (nextValue: string, cursor: number) => {
        const prefix = nextValue.slice(0, cursor);
        const match = /(^|[\s\S])@([^\s@]*)$/.exec(prefix);
        if (!match || !references.some((item) => item.active)) {
            closeMention();
            return;
        }
        setMention({ start: cursor - match[2].length - 1, end: cursor, query: match[2] });
        setActiveIndex(0);
    };

    const insertReference = (reference: CanvasResourceReference) => {
        if (!mention) return;
        const insertText = `@${reference.label} `;
        const next = `${value.slice(0, mention.start)}${insertText}${value.slice(mention.end)}`;
        closeMention();
        updateValue(next, mention.start + insertText.length);
    };

    const updateSelectionState = () => {
        const textarea = textareaRef.current;
        setHasSelection(Boolean(textarea && textarea.selectionStart !== textarea.selectionEnd));
    };

    const syncOverlayScroll = () => {
        if (!overlayRef.current || !textareaRef.current) return;
        overlayRef.current.scrollTop = textareaRef.current.scrollTop;
        overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
    };

    const showHighlight = Boolean(highlightLabels && !isFocused && value && activeLabels.some((label) => value.includes(label)));
    const mergedStyle = {
        ...(style || {}),
        color: showHighlight ? "transparent" : style?.color,
        caretColor: style?.color || theme.node.text,
        ...(showHighlight ? { background: "transparent", backgroundColor: "transparent" } : {}),
    } as CSSProperties;
    const menu = mention && candidates.length && textareaRef.current ? <MentionMenu anchor={textareaRef.current} references={candidates} activeIndex={Math.min(activeIndex, candidates.length - 1)} theme={theme} onSelect={insertReference} /> : null;

    const content = (
        <div className={`relative h-full w-full ${containerClassName || ""}`} data-canvas-no-zoom onWheel={(event) => event.stopPropagation()}>
            {showHighlight ? (
                <div ref={overlayRef} className={`${className || ""} pointer-events-none absolute inset-0 z-0 overflow-hidden whitespace-pre-wrap break-words`} style={{ ...style, color: theme.node.text }}>
                    <MentionHighlightText value={value} labels={activeLabels} />
                </div>
            ) : null}
            <textarea
                {...props}
                placeholder={isFocused ? "" : placeholder}
                ref={(node) => {
                    textareaRef.current = node;
                    if (typeof forwardedRef === "function") forwardedRef(node);
                    else if (forwardedRef) forwardedRef.current = node;
                }}
                value={value}
                className={`${className || ""} relative z-[1]`}
                style={mergedStyle}
                onChange={(event) => {
                    const next = event.target.value;
                    pendingSelectionRef.current = { start: event.target.selectionStart, end: event.target.selectionEnd };
                    onChange(next);
                    syncMention(next, event.target.selectionStart);
                    requestAnimationFrame(() => {
                        syncOverlayScroll();
                        updateSelectionState();
                    });
                }}
                onFocus={(event) => {
                    setIsFocused(true);
                    props.onFocus?.(event);
                }}
                onSelect={(event) => {
                    updateSelectionState();
                    props.onSelect?.(event);
                }}
                onKeyUp={(event) => {
                    updateSelectionState();
                    props.onKeyUp?.(event);
                }}
                onPointerUp={(event) => {
                    updateSelectionState();
                    props.onPointerUp?.(event);
                }}
                onKeyDown={(event) => {
                    if (isImeComposing(event)) {
                        onKeyDown?.(event);
                        return;
                    }
                    if (mention && candidates.length) {
                        if (event.key === "ArrowDown") {
                            event.preventDefault();
                            setActiveIndex((index) => (index + 1) % candidates.length);
                            return;
                        }
                        if (event.key === "ArrowUp") {
                            event.preventDefault();
                            setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
                            return;
                        }
                        if (event.key === "Enter") {
                            event.preventDefault();
                            insertReference(candidates[Math.min(activeIndex, candidates.length - 1)]);
                            return;
                        }
                        if (event.key === "Escape") {
                            event.preventDefault();
                            closeMention();
                            return;
                        }
                    }
                    if (isPlainEnterKey(event) && onSubmit) {
                        event.preventDefault();
                        onSubmit();
                        return;
                    }
                    onKeyDown?.(event);
                }}
                onScroll={(event) => {
                    syncOverlayScroll();
                    props.onScroll?.(event);
                }}
                onBlur={(event) => {
                    setIsFocused(false);
                    setHasSelection(false);
                    window.setTimeout(closeMention, 120);
                    props.onBlur?.(event);
                }}
            />
            {menu}
            {expandable ? (
                <Button
                    type="text"
                    size="small"
                    aria-label={`放大${expandTitle}`}
                    title={`放大${expandTitle}`}
                    icon={<Maximize2 className="size-3.5" />}
                    className="!absolute right-1 top-1 z-10 !grid !size-7 !min-w-7 !place-items-center !p-0 opacity-70 hover:!opacity-100"
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => setExpanded(true)}
                />
            ) : null}
        </div>
    );

    return (
        <>
            {content}
            {expandable ? (
                <Modal title={expandTitle} open={expanded} footer={null} centered width="min(92vw, 900px)" onCancel={() => setExpanded(false)}>
                    <CanvasResourceMentionTextarea
                        {...props}
                        value={value}
                        references={references}
                        onChange={onChange}
                        onSubmit={onSubmit}
                        onKeyDown={onKeyDown}
                        placeholder={placeholder}
                        className="!h-[min(68vh,560px)] !w-full resize-none"
                        style={style}
                        highlightLabels={highlightLabels}
                        expandable={false}
                        expandTitle={expandTitle}
                    />
                </Modal>
            ) : null}
        </>
    );
}

function MentionHighlightText({ value, labels }: { value: string; labels: string[] }) {
    if (!labels.length) return <>{value}</>;
    const pattern = new RegExp(`(${labels.map(escapeRegExp).join("|")})`, "g");
    return (
        <>
            {value.split(pattern).map((part, index) =>
                labels.includes(part) ? (
                    <span key={`${part}-${index}`} className="rounded-md bg-[#2f80ff]/20 text-[#2f80ff]">
                        {part}
                    </span>
                ) : (
                    <span key={`${part}-${index}`}>{part}</span>
                ),
            )}
        </>
    );
}

function CanvasRichMentionEditor({ value, references, onChange, onSubmit, onKeyDown, onFocus, onBlur, className, containerClassName, style, placeholder, placeholderClassName, autoFocus, header, expandedFooter, mentionInsertRequest, expandable = true, expandTitle = "编辑内容" }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const editorRef = useRef<HTMLDivElement | null>(null);
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [expanded, setExpanded] = useState(false);
    const [focused, setFocused] = useState(false);
    const savedRangeRef = useRef<Range | null>(null);
    const lastHandledMentionRequestRef = useRef(0);
    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = mention.query.trim().toLowerCase();
        return references.filter((item) => item.active && (!query || `${item.label} ${item.title} ${item.kind} ${item.text || ""}`.toLowerCase().includes(query)));
    }, [mention, references]);

    const rememberSelection = () => {
        const editor = editorRef.current;
        const selection = window.getSelection();
        if (!editor || !selection?.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (editor.contains(range.startContainer) && editor.contains(range.endContainer)) savedRangeRef.current = range.cloneRange();
    };

    useLayoutEffect(() => {
        if (!editorRef.current || focused) return;
        if (serializeEditor(editorRef.current) !== value) editorRef.current.innerHTML = richEditorHtml(value, references);
    }, [focused, references, value]);

    useEffect(() => {
        if (!autoFocus) return;
        const frame = window.requestAnimationFrame(() => editorRef.current?.focus());
        return () => window.cancelAnimationFrame(frame);
    }, [autoFocus]);

    useLayoutEffect(() => {
        const editor = editorRef.current;
        if (!mentionInsertRequest || !editor || !focused || lastHandledMentionRequestRef.current === mentionInsertRequest.nonce) return;
        const currentRange = selectionRangeInside(editor) || savedRangeRef.current;
        const range = currentRange?.cloneRange() || document.createRange();
        if (!currentRange) {
            range.selectNodeContents(editor);
            range.collapse(false);
        }
        lastHandledMentionRequestRef.current = mentionInsertRequest.nonce;
        insertRichMention(editor, range, mentionInsertRequest.reference);
        rememberSelection();
        onChange(serializeEditor(editor));
    }, [focused, mentionInsertRequest, onChange]);

    const updateMention = () => {
        const editor = editorRef.current;
        const selection = window.getSelection();
        if (!editor || !selection?.rangeCount || !selection.isCollapsed) return setMention(null);
        const cursor = selection.getRangeAt(0).cloneRange();
        cursor.selectNodeContents(editor);
        if (!selection.anchorNode) return setMention(null);
        cursor.setEnd(selection.anchorNode, selection.anchorOffset);
        const before = cursor.toString();
        const match = /(^|[\s\S])@([^\s@]*)$/.exec(before);
        if (!match) return setMention(null);
        setMention({ start: before.length - match[2].length - 1, end: before.length, query: match[2] });
        setActiveIndex(0);
    };
    const emitChange = () => {
        if (editorRef.current) onChange(serializeEditor(editorRef.current));
        updateMention();
    };
    const insertReference = (reference: CanvasResourceReference) => {
        const editor = editorRef.current;
        const selection = window.getSelection();
        if (!editor || !selection?.rangeCount || !mention) return;
        const range = selection.getRangeAt(0);
        const text = range.startContainer;
        if (text.nodeType !== Node.TEXT_NODE) return;
        const start = Math.max(0, range.startOffset - mention.query.length - 1);
        range.setStart(text, start);
        range.deleteContents();
        insertRichMention(editor, range, reference);
        rememberSelection();
        setMention(null);
        onChange(serializeEditor(editor));
    };
    const menu = mention && candidates.length && editorRef.current ? <MentionMenu anchor={editorRef.current} references={candidates} activeIndex={activeIndex} theme={theme} onSelect={insertReference} /> : null;
    return (
        <div className={`relative flex h-full w-full flex-col ${containerClassName || ""}`} data-canvas-no-zoom onWheel={(event) => event.stopPropagation()}>
            {header ? <div className={`shrink-0 ${expandable ? "pr-8" : ""}`}>{header}</div> : null}
            <div className="relative min-h-0 flex-1">
                {!value.trim() && !focused && placeholder ? <div className={`pointer-events-none absolute inset-x-3 top-2 z-[2] whitespace-pre-wrap text-[12px] leading-5 ${placeholderClassName || ""}`} style={{ color: theme.node.muted }}><MentionPlaceholderText value={placeholder} /></div> : null}
                <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    className={`${className || ""} relative z-[1] overflow-y-auto whitespace-pre-wrap`}
                    style={style}
                    onFocus={(event) => { setFocused(true); updateMention(); rememberSelection(); onFocus?.(event as never); }}
                    onBlur={(event) => { setFocused(false); setMention(null); onBlur?.(event as never); }}
                    onInput={() => { emitChange(); rememberSelection(); }}
                    onKeyDown={(event) => {
                        if (mention && candidates.length) {
                            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + candidates.length) % candidates.length); return; }
                            if (event.key === "Enter") { event.preventDefault(); insertReference(candidates[activeIndex]); return; }
                            if (event.key === "Escape") { event.preventDefault(); setMention(null); return; }
                        }
                        if (event.key === "Enter" && onSubmit && !event.shiftKey) { event.preventDefault(); onSubmit(); return; }
                        onKeyDown?.(event as never);
                    }}
                    onKeyUp={(event) => {
                        // Arrow navigation is handled on keydown; re-scanning here would reset the highlighted item.
                        if (event.key === "ArrowDown" || event.key === "ArrowUp") return;
                        updateMention();
                        rememberSelection();
                    }}
                    onMouseUp={rememberSelection}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                />
                {menu}
            </div>
            {expandable ? <Button type="text" size="small" aria-label={`放大${expandTitle}`} title={`放大${expandTitle}`} icon={<Maximize2 className="size-3.5" />} className="!absolute right-1 top-1 z-10 !grid !size-7 !min-w-7 !place-items-center !p-0 opacity-70 hover:!opacity-100" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onClick={() => setExpanded(true)} /> : null}
            {expandable ? (
                <Modal
                    className="canvas-expanded-mention-modal"
                    title={expandTitle}
                    open={expanded}
                    footer={null}
                    centered
                    width="min(92vw, 1040px)"
                    styles={{ body: { padding: 0 } }}
                    onCancel={() => setExpanded(false)}
                >
                    <div className="flex h-[min(72vh,620px)] min-h-80 flex-col overflow-hidden px-4 pb-3">
                        <div className="min-h-0 flex-1">
                            <CanvasRichMentionEditor
                                value={value}
                                references={references}
                                onChange={onChange}
                                onSubmit={onSubmit}
                                onKeyDown={onKeyDown}
                                placeholder={placeholder}
                                placeholderClassName={placeholderClassName}
                                header={header}
                                containerClassName="canvas-expanded-mention-editor"
                                className="h-full w-full overflow-y-auto border-0 bg-transparent px-1 py-1 text-[15px] leading-7 outline-none shadow-none focus:outline-none"
                                style={{ ...style, background: "transparent", backgroundColor: "transparent", border: "none", outline: "none", boxShadow: "none" }}
                                autoFocus
                                expandable={false}
                                expandTitle={expandTitle}
                                mentionInsertRequest={mentionInsertRequest}
                            />
                        </div>
                        {expandedFooter ? (
                            <div className="shrink-0 border-t pt-2" style={{ borderColor: theme.toolbar.border }}>
                                {expandedFooter}
                            </div>
                        ) : null}
                    </div>
                </Modal>
            ) : null}
        </div>
    );
}

function MentionMenu({ anchor, references, activeIndex, theme, onSelect }: { anchor: HTMLElement; references: CanvasResourceReference[]; activeIndex: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onSelect: (reference: CanvasResourceReference) => void }) {
    const selectedRef = useRef(false);
    const assetLeaveTimer = useRef<number | null>(null);
    const [assetRowRect, setAssetRowRect] = useState<DOMRect | null>(null);
    const [, refreshPosition] = useState(0);
    useLayoutEffect(() => {
        const update = () => refreshPosition((value) => value + 1);
        window.addEventListener("resize", update);
        window.addEventListener("scroll", update, true);
        return () => {
            window.removeEventListener("resize", update);
            window.removeEventListener("scroll", update, true);
        };
    }, [anchor]);
    const rect = mentionAnchorRect(anchor);
    const boundary = anchor.closest(".ant-modal-content")?.getBoundingClientRect() || { left: 8, top: 8, right: window.innerWidth - 8, bottom: window.innerHeight - 8 };
    const menuWidth = 256;
    const maxMenuHeight = 224;
    const menuHeight = Math.min(maxMenuHeight, Math.max(56, (references.some((reference) => reference.source === "user-asset") ? references.filter((reference) => reference.source !== "user-asset").length + 1 : references.length) * 48 + 8));
    const gap = 6;
    const left = clamp(rect.left, boundary.left + 8, boundary.right - menuWidth - 8);
    const showAbove = rect.bottom + gap + menuHeight > boundary.bottom && rect.top - gap - menuHeight >= boundary.top;
    const top = clamp(showAbove ? rect.top - gap - menuHeight : rect.bottom + gap, boundary.top + 8, boundary.bottom - menuHeight - 8);
    const canvasReferences = references.filter((reference) => reference.source !== "user-asset");
    const assetReferences = references.filter((reference) => reference.source === "user-asset");
    const assetMenuTop = assetRowRect ? clamp(assetRowRect.top, boundary.top + 8, boundary.bottom - maxMenuHeight - 8) : top;
    const assetMenuLeft = assetRowRect
        ? assetRowRect.right + gap + menuWidth <= boundary.right - 8
            ? assetRowRect.right + gap
            : clamp(assetRowRect.left - menuWidth - gap, boundary.left + 8, boundary.right - menuWidth - 8)
        : left + menuWidth + gap;

    const stopCanvasInteraction = (event: PointerEvent | MouseEvent) => {
        event.stopPropagation();
    };
    const selectReference = (reference: CanvasResourceReference) => {
        if (selectedRef.current) return;
        selectedRef.current = true;
        onSelect(reference);
    };

    const keepAssetMenuOpen = () => {
        if (assetLeaveTimer.current !== null) window.clearTimeout(assetLeaveTimer.current);
    };
    const closeAssetMenuSoon = () => {
        if (assetLeaveTimer.current !== null) window.clearTimeout(assetLeaveTimer.current);
        assetLeaveTimer.current = window.setTimeout(() => setAssetRowRect(null), 140);
    };
    useEffect(() => () => {
        if (assetLeaveTimer.current !== null) window.clearTimeout(assetLeaveTimer.current);
    }, []);

    return createPortal(
        <>
        <div
            data-canvas-resource-mention-menu="true"
            data-canvas-no-zoom
            className="fixed z-[1400] max-h-56 w-64 overflow-y-auto rounded-xl border p-1 shadow-2xl backdrop-blur-md"
            style={{ left, top, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={stopCanvasInteraction}
            onMouseDown={stopCanvasInteraction}
            onWheel={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            {canvasReferences.map((reference, index) => (
                <button
                    key={reference.id}
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition"
                    style={{ background: index === activeIndex ? theme.toolbar.activeBg : "transparent", color: index === activeIndex ? theme.toolbar.activeText : theme.node.text }}
                    onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        selectReference(reference);
                    }}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        selectReference(reference);
                    }}
                >
                    <ReferencePreview reference={reference} />
                    <span className="min-w-0 flex-1 overflow-hidden">
                        <span className="block truncate font-medium">{reference.label}</span>
                        <span className="block truncate opacity-65">{reference.text || reference.title}</span>
                    </span>
                </button>
            ))}
            {assetReferences.length ? <button
                type="button"
                className="flex min-h-12 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition"
                style={{ background: assetRowRect ? theme.toolbar.activeBg : "transparent", color: assetRowRect ? theme.toolbar.activeText : theme.node.text }}
                onMouseEnter={(event) => { keepAssetMenuOpen(); setAssetRowRect(event.currentTarget.getBoundingClientRect()); }}
                onMouseLeave={closeAssetMenuSoon}
                onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                onClick={(event) => event.stopPropagation()}
            >
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-black/10"><FolderOpen className="size-4" /></span>
                <span className="min-w-0 flex-1 overflow-hidden"><span className="block truncate font-medium">资产库</span><span className="block truncate opacity-65">图片、视频资产</span></span>
                <ChevronRight className="size-4 shrink-0 opacity-60" />
            </button> : null}
        </div>
        {assetRowRect ? <div
            data-canvas-no-zoom
            className="fixed z-[1401] max-h-56 w-64 overflow-y-auto rounded-xl border p-1 shadow-2xl backdrop-blur-md"
            style={{ left: assetMenuLeft, top: assetMenuTop, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseEnter={keepAssetMenuOpen}
            onMouseLeave={closeAssetMenuSoon}
            onPointerDown={stopCanvasInteraction}
            onMouseDown={stopCanvasInteraction}
            onWheel={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            {assetReferences.map((reference, index) => (
                <button
                    key={reference.id}
                    type="button"
                    className="flex min-h-12 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition"
                    style={{ background: index + canvasReferences.length === activeIndex ? theme.toolbar.activeBg : "transparent", color: index + canvasReferences.length === activeIndex ? theme.toolbar.activeText : theme.node.text }}
                    onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); selectReference(reference); }}
                    onClick={(event) => { event.preventDefault(); event.stopPropagation(); selectReference(reference); }}
                >
                    <ReferencePreview reference={reference} />
                    <span className="min-w-0 flex-1 overflow-hidden">
                        <span className="block truncate font-medium">{reference.title || reference.label}</span>
                        <span className="block truncate opacity-65">我的资产 · {reference.kind === "image" ? "图片" : "视频"}</span>
                    </span>
                </button>
            ))}
        </div> : null}
        </>,
        document.body,
    );
}

function mentionAnchorRect(anchor: HTMLElement) {
    if (!anchor.isContentEditable) return anchor.getBoundingClientRect();
    const selection = window.getSelection();
    if (!selection?.rangeCount) return anchor.getBoundingClientRect();
    const range = selection.getRangeAt(0);
    if (!anchor.contains(range.startContainer)) return anchor.getBoundingClientRect();
    const caretRange = range.cloneRange();
    caretRange.collapse(true);
    const rect = caretRange.getClientRects().item(0) || caretRange.getBoundingClientRect();
    return Number.isFinite(rect.left) && Number.isFinite(rect.top) && (rect.left !== 0 || rect.top !== 0 || rect.width !== 0 || rect.height !== 0) ? rect : anchor.getBoundingClientRect();
}

function MentionPlaceholderText({ value }: { value: string }) {
    const parts = value.split(/(@[^\s，。！？：:]*)/g);
    return <>{parts.map((part, index) => part.startsWith("@") ? <span key={`${part}-${index}`} className="text-[#2f80ff]">{part}</span> : <span key={`${part}-${index}`}>{part}</span>)}</>;
}

function richEditorHtml(value: string, references: CanvasResourceReference[]) {
    const tokens = parseCanvasResourceMentionTokens(value);
    if (tokens.length) {
        let html = "";
        let cursor = 0;
        tokens.forEach((token) => {
            html += legacyRichEditorHtml(value.slice(cursor, token.start), references);
            const reference = references.find((item) => item.nodeId === token.nodeId);
            html += reference && reference.active
                ? mentionTokenHtml(reference)
                : missingMentionTokenHtml(token.nodeId, reference?.label || token.label);
            cursor = token.end;
        });
        return html + legacyRichEditorHtml(value.slice(cursor), references);
    }
    return legacyRichEditorHtml(value, references);
}

function legacyRichEditorHtml(value: string, references: CanvasResourceReference[]) {
    const labels = references.filter((item) => item.active).map((item) => item.label).sort((left, right) => right.length - left.length);
    if (!labels.length) return escapeHtml(value);
    const parts = value.split(new RegExp(`(@?(?:${labels.map(escapeRegExp).join("|")}))`, "g"));
    return parts.map((part) => {
        const reference = references.find((item) => item.label === (part.startsWith("@") ? part.slice(1) : part) && item.active);
        if (!reference) return escapeHtml(part);
        return mentionTokenHtml(reference);
    }).join("");
}

function mentionTokenHtml(reference: CanvasResourceReference) {
    return `<span contenteditable="false" data-mention-id="${escapeAttribute(reference.nodeId)}" data-mention-label="${escapeAttribute(reference.label)}" title="${escapeAttribute(reference.title || reference.label)}" class="${mentionTokenClassName}">${mentionPreviewHtml(reference)}<span class="${mentionTokenLabelClassName}">${escapeHtml(reference.label)}</span></span>`;
}

function missingMentionTokenHtml(nodeId: string, label: string) {
    return `<span contenteditable="false" data-mention-id="${escapeAttribute(nodeId)}" data-mention-label="${escapeAttribute(label)}" title="引用已失效" class="${mentionTokenClassName} !bg-red-500/15 !text-red-400"><span class="${mentionTokenLabelClassName}">${escapeHtml(label)}（引用已失效）</span></span>`;
}

const mentionTokenClassName = "mx-0.5 inline-flex max-w-[240px] min-w-0 select-none items-center gap-1 rounded-md bg-[#2f80ff]/16 px-1 align-middle text-[13px] font-medium leading-7 text-[#2f80ff]";
const mentionTokenLabelClassName = "min-w-0 truncate";

function selectionRangeInside(editor: HTMLElement) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return editor.contains(range.startContainer) && editor.contains(range.endContainer) ? range : null;
}

function insertRichMention(editor: HTMLElement, range: Range, reference: CanvasResourceReference) {
    range.deleteContents();
    const token = document.createElement("span");
    token.contentEditable = "false";
    token.dataset.mentionId = reference.nodeId;
    token.dataset.mentionLabel = reference.label;
    token.title = reference.title || reference.label;
    token.className = mentionTokenClassName;
    token.innerHTML = mentionPreviewHtml(reference);
    const label = document.createElement("span");
    label.className = mentionTokenLabelClassName;
    label.textContent = reference.label;
    token.append(label);
    range.insertNode(token);
    const spacer = document.createTextNode(" ");
    token.after(spacer);
    range.setStartAfter(spacer);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    editor.focus();
}

function serializeEditor(editor: HTMLElement) {
    return Array.from(editor.childNodes).map(serializeEditorNode).join("").replace(/\u00a0/g, " ").replace(/\n$/, "");
}

function serializeEditorNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
    if (!(node instanceof HTMLElement)) return Array.from(node.childNodes).map(serializeEditorNode).join("");
    if (node.dataset.mentionId) return serializeCanvasResourceMention(node.dataset.mentionId, node.dataset.mentionLabel || node.lastElementChild?.textContent || node.textContent || "");
    if (node.tagName === "BR") return "\n";
    const content = Array.from(node.childNodes).map(serializeEditorNode).join("");
    return node !== node.ownerDocument?.body && (node.tagName === "DIV" || node.tagName === "P") ? `${content}\n` : content;
}

function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}

function escapeAttribute(value: string) {
    return escapeHtml(value);
}

function mentionPreviewHtml(reference: CanvasResourceReference) {
    if (reference.kind === "audio") return `<span class="grid size-5 shrink-0 place-items-center rounded-sm bg-[#2f80ff]/18 text-[16px] leading-none" aria-hidden="true">&#9835;</span>`;
    if (reference.previewUrl && reference.kind === "video") return `<video src="${escapeAttribute(reference.previewUrl)}" class="size-5 shrink-0 rounded-sm bg-black object-cover" muted preload="metadata"></video>`;
    if (reference.previewUrl && reference.kind === "image") return `<img src="${escapeAttribute(reference.previewUrl)}" alt="" class="size-5 shrink-0 rounded-sm object-cover" />`;
    return "";
}

function ReferencePreview({ reference }: { reference: CanvasResourceReference }) {
    if (reference.kind === "image" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="size-9 rounded-md object-cover" />;
    if (reference.kind === "video" && reference.previewUrl) return <video src={reference.previewUrl} className="size-9 rounded-md bg-black object-cover" muted preload="metadata" />;
    const Icon = reference.kind === "audio" ? Music2 : reference.kind === "video" ? Video : reference.kind === "image" ? ImageIcon : FileText;
    return (
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-black/10">
            <Icon className="size-4" />
        </span>
    );
}

function clamp(value: number, min: number, max: number) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
