import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Bot, Group, Home, ImageIcon, Images, List, Menu, MousePointer2, Music2, Plus, Redo2, ScanText, Trash2, Type, Undo2, Upload, Video, X } from "lucide-react";
import { saveAs } from "file-saver";

import { requestEdit, requestGeneration, requestImageQuestion } from "@/services/api/image";
import { cancelCanvasAudioTask, pollCanvasAudioTask, requestAudioGeneration, requestVoiceDesign, storeGeneratedAudio, type StoredGeneratedAudio } from "@/services/api/audio";
import { requestVideoGeneration, storeGeneratedVideo } from "@/services/api/video";
import { cancelQueuedCanvasVideoTask, createCanvasVideoTask, isCanvasVideoModel, waitForCanvasVideoTask, type CanvasVideoStoredResult, type CanvasVideoTask } from "@/services/api/canvas-video";
import { SHOW_AGENT_UI, SUCAI_INTEGRATION } from "@/constant/env";
import { defaultConfig, modelOptionName, type AiConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { getImageBlob, imageToDataUrl, resolveImageUrl, resolvePersistedImageUrl, uploadImage, type UploadedImage } from "@/services/image-storage";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { resolveCanvasMediaUrl } from "@/services/canvas-media";
import { nanoid } from "nanoid";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { normalizeImageCount } from "@/lib/image-settings";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { requestCanvasLogin } from "@/components/layout/canvas-login-modal";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { cropDataUrl, splitDataUrl, upscaleDataUrl } from "@/lib/canvas/canvas-image-data";
import { fitNodeSize, nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import { playGenerationCompleteSound, unlockGenerationCompleteSound } from "@/lib/generation-complete-sound";
import { App, Button, Dropdown, Modal } from "antd";
import { NODE_DEFAULT_SIZE, getNodeSpec } from "@/constant/canvas";
import { ActiveConnectionPath, ConnectionPath, getConnectionBounds } from "@/components/canvas/canvas-connections";
import { CanvasNodeContextMenu } from "@/components/canvas/canvas-context-menu";
import { CanvasNodeAngleDialog, type CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import { CanvasNodeCropDialog, type CanvasImageCropRect } from "@/components/canvas/canvas-node-crop-dialog";
import { CanvasNodeMaskEditDialog, type CanvasImageMaskEditPayload } from "@/components/canvas/canvas-node-mask-edit-dialog";
import { CanvasNodeSplitDialog, type CanvasImageSplitParams } from "@/components/canvas/canvas-node-split-dialog";
import { CanvasNodeUpscaleDialog, type CanvasImageUpscaleParams } from "@/components/canvas/canvas-node-upscale-dialog";
import { buildNodeGenerationContext, buildNodeResponseMessages, hydrateNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { CanvasNodeHoverToolbar, CanvasNodeInfoModal } from "@/components/canvas/canvas-node-hover-toolbar";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { Minimap } from "@/components/canvas/canvas-mini-map";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasNodeGenerationOptions } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { CanvasSidePanel } from "@/components/canvas/canvas-side-panel";
import { CanvasZoomControls } from "@/components/canvas/canvas-zoom-controls";
import { useAgentStore } from "@/stores/use-agent-store";
import { flushCanvasPersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasHostTaskStore } from "@/stores/canvas/use-canvas-host-task-store";
import { useUserStore } from "@/stores/use-user-store";
import { canvasScriptApi } from "@/services/api/canvas-script";
import { canvasTextApi } from "@/services/api/canvas-text";
import { syncSucaiCanvasProject } from "@/services/sucai-canvas-sync";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { buildCanvasResourceReferences, buildNodeMentionReferences, mergeCanvasReferenceOrder, normalizeCanvasResourceMentions, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { createCanvasGraphIndex, incomingConnections, outgoingConnections } from "@/lib/canvas/canvas-graph-index";
import { createCanvasSpatialIndex } from "@/lib/canvas/canvas-spatial-index";
import { sameNodeGeometry } from "@/lib/canvas/canvas-geometry";
import { emitCanvasEvent, onCanvasEvent } from "@/lib/canvas/canvas-event-bus";
import { getNodeDefinition, getNodePluginId, isBuiltinNodeType as isBuiltinType, listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { ensurePluginsLoaded } from "@/lib/canvas/plugin-loader";
import { registerBuiltinNodes } from "@/components/canvas/nodes/builtin-nodes";
import { CanvasPluginManagerModal } from "@/components/canvas/canvas-plugin-manager-modal";
import type { CanvasPluginHost } from "@/types/canvas-plugin";
import {
    CanvasNodeType,
    type CanvasAssistantImage,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasImageGenerationType,
    type CanvasNodeData,
    type CanvasNodeStatus,
    type CanvasNodeMetadata,
    type CanvasNodeTypeId,
    type ConnectionHandle,
    type ContextMenuState,
    type Position,
    type SelectionBox,
    type ViewportTransform,
} from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio } from "@/types/media";

// 内置节点注册到统一注册表(模块加载时执行一次)
registerBuiltinNodes();

type CanvasClipboard = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

type PendingConnectionCreate = {
    connections: ConnectionHandle[];
    position: Position;
    anchorPosition?: Position;
    menuPosition?: Position;
};

type ConnectionDropTarget = {
    nodeId: string | null;
    isNearNode: boolean;
};

type CanvasHistoryEntry = Pick<CanvasClipboard, "nodes" | "connections"> & {
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
};

type CanvasGenerationRequest = {
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
    controller: AbortController;
    taskId: string;
};

type NodeDragState = {
    isDraggingNode: boolean;
    hasMoved: boolean;
    startX: number;
    startY: number;
    previewDx: number;
    previewDy: number;
    initialSelectedNodes: { id: string; x: number; y: number }[];
    initialById: Map<string, { id: string; x: number; y: number }>;
    movedIds: Set<string>;
    nodeById: Map<string, CanvasNodeData>;
    nodeElements: Map<string, HTMLElement>;
    connectionElements: Array<{ connection: CanvasConnection; paths: SVGPathElement[] }>;
};

const VIDEO_NODE_MAX_WIDTH = 420;
const VIDEO_NODE_MAX_HEIGHT = 420;
const CONNECTION_HANDLE_HIT_RADIUS = 16;
const CONNECTION_NODE_HIT_PADDING = 32;
const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;
const EMPTY_RESOURCE_REFERENCES: CanvasResourceReference[] = [];

function canvasTaskStage(node?: CanvasNodeData) {
    if (!node) return "AI 生成";
    if (node.type === CanvasNodeType.Text) return "生成文本";
    if (node.type === CanvasNodeType.Image) return "生成图片";
    if (node.type === CanvasNodeType.Video) return "生成视频";
    if (node.type === CanvasNodeType.Audio) return "生成音频";
    return "处理画布节点";
}
const IMAGE_PROMPT_REVERSE_PRESET = `请根据参考图片反推一段适合用于 AI 生图的提示词。

要求：
1. 只输出提示词正文，不要解释。
2. 覆盖主体、构图、风格、光线、色彩、材质、镜头和氛围。
3. 尽量写成可直接用于生图模型的完整提示词。`;
const SHOW_CANVAS_PLUGIN_UI = import.meta.env.VITE_SHOW_CANVAS_PLUGIN_UI !== "false";

function createCanvasNode(type: CanvasNodeTypeId, position: Position, metadata?: CanvasNodeMetadata): CanvasNodeData {
    const spec = getNodeSpec(type);
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    return {
        id,
        type,
        title: spec.title,
        position: {
            x: position.x - spec.width / 2,
            y: position.y - spec.height / 2,
        },
        width: spec.width,
        height: spec.height,
        metadata: { ...spec.metadata, ...metadata },
    };
}

export default function CanvasPage() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <CanvasRefreshShell />;

    return <InfiniteCanvasPage />;
}

function CanvasRefreshShell() {
    return (
        <main className="relative h-full min-h-0 overflow-hidden bg-background text-foreground">
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
                    backgroundSize: "28px 28px",
                }}
            />

            <div className="absolute bottom-5 left-1/2 z-50 flex h-14 -translate-x-1/2 items-center gap-1 rounded-xl border px-2 shadow-lg backdrop-blur" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                {Array.from({ length: 7 }).map((_, index) => (
                    <div key={index} className="size-8 rounded-md bg-current opacity-10" />
                ))}
            </div>

            <div className="absolute bottom-24 left-6 z-50 h-40 w-[240px] rounded-lg border shadow-2xl backdrop-blur-sm" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                <div className="absolute left-7 top-7 h-5 w-12 rounded-sm bg-current opacity-10" />
                <div className="absolute left-28 top-16 h-6 w-16 rounded-sm bg-current opacity-10" />
                <div className="absolute bottom-7 left-16 h-8 w-20 rounded-sm bg-current opacity-10" />
                <div className="absolute inset-5 rounded border border-current opacity-15" />
            </div>

            <div className="absolute bottom-5 left-5 z-50 flex h-14 w-[260px] items-center gap-2 rounded-xl border px-2 shadow-lg backdrop-blur" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="h-1 flex-1 rounded-full bg-current opacity-10" />
                <div className="h-4 w-10 rounded bg-current opacity-10" />
                <div className="size-8 rounded-md bg-current opacity-10" />
            </div>
        </main>
    );
}

function ConnectionCreateMenu({
    pending,
    scale,
    onCreate,
    onClose,
}: {
    pending: PendingConnectionCreate;
    scale: number;
    onCreate: (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Video | CanvasNodeType.Audio) => void;
    onClose: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const menuPosition = pending.menuPosition || pending.position;
    const isBatch = pending.connections.length > 1;
    return (
        <div
            className={`absolute z-[120] origin-top-left rounded-[8px] border p-2 shadow-2xl backdrop-blur ${isBatch ? "w-[292px]" : "w-[420px]"}`}
            data-connection-create-menu
            data-canvas-no-zoom
            style={{ left: menuPosition.x, top: menuPosition.y, transform: `scale(${1 / Math.max(scale, 0.05)})`, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-1.5 flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold" style={{ color: theme.node.text }}>
                    {isBatch ? `引用选中的 ${pending.connections.length} 个节点` : "选择生成类型"}
                </span>
                <button type="button" className="grid size-6 place-items-center rounded-md text-sm opacity-55 transition hover:bg-white/10 hover:opacity-100" onClick={onClose} aria-label="关闭">
                    ×
                </button>
            </div>
            <div className={`grid gap-1 ${isBatch ? "grid-cols-1" : "grid-cols-2"}`}>
                <ConnectionCreateOption theme={theme} icon={<List className="size-5" />} title="文本生成" description="脚本、广告词、品牌文案" onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption theme={theme} icon={<ImageIcon className="size-5" />} title="图片生成" onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption theme={theme} icon={<Video className="size-5" />} title="视频生成" onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption theme={theme} icon={<Music2 className="size-5" />} title="音频参考" onClick={() => onCreate(CanvasNodeType.Audio)} />
            </div>
        </div>
    );
}

function ConnectionCreateOption({ theme, icon, title, description, accent, onClick }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; icon: React.ReactNode; title: string; description?: string; accent?: { color: string; background: string }; onClick?: () => void }) {
    return (
        <button
            type="button"
            className="flex h-11 w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left transition"
            style={{ color: theme.node.text }}
            onClick={onClick}
            onMouseEnter={(event) => (event.currentTarget.style.background = theme.node.fill)}
            onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
        >
            <span className="grid size-8 shrink-0 place-items-center rounded-md [&_svg]:size-4" style={{ background: accent?.background || theme.node.fill, color: accent?.color || theme.node.muted }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold leading-4">{title}</span>
                {description ? (
                    <span className="block truncate text-[10px] leading-[13px]" style={{ color: theme.node.muted }}>
                        {description}
                    </span>
                ) : null}
            </span>
        </button>
    );
}

function nodeCreateMenuAccent(type: string) {
    const accents: Record<string, { color: string; background: string }> = {
        [CanvasNodeType.Text]: { color: "#818cf8", background: "rgba(99,102,241,.14)" },
        [CanvasNodeType.Image]: { color: "#34d399", background: "rgba(16,185,129,.14)" },
        [CanvasNodeType.Video]: { color: "#22d3ee", background: "rgba(6,182,212,.14)" },
        [CanvasNodeType.Audio]: { color: "#fb7185", background: "rgba(244,63,94,.14)" },
        [CanvasNodeType.Group]: { color: "#a78bfa", background: "rgba(139,92,246,.14)" },
        [CanvasNodeType.AssetExtraction]: { color: "#38bdf8", background: "rgba(14,165,233,.14)" },
        [CanvasNodeType.ScriptAsset]: { color: "#34d399", background: "rgba(16,185,129,.14)" },
    };
    return accents[type] || { color: "#38bdf8", background: "rgba(14,165,233,.14)" };
}

function NodeCreateMenu({ position, scale, onCreate, onClose }: { position: Position; scale: number; onCreate: (type: string) => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    useNodeRegistryVersion();
    const menuRef = useRef<HTMLDivElement>(null);
    const definitions = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false && (SHOW_CANVAS_PLUGIN_UI || getNodePluginId(def.type) === "builtin"));
    // 点击菜单外的空白处自动关闭
    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [onClose]);
    return (
        <div
            ref={menuRef}
            className="absolute z-[120] max-h-[66vh] w-[240px] origin-top-left overflow-y-auto rounded-xl border p-2 shadow-2xl backdrop-blur thin-scrollbar"
            data-canvas-no-zoom
            style={{ left: position.x, top: position.y, transform: `scale(${1 / Math.max(scale, 0.05)})`, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-1 flex items-center justify-between px-1">
                <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                    选择节点
                </span>
                <button type="button" className="grid size-6 place-items-center rounded-md opacity-55 transition hover:opacity-100" onClick={onClose} aria-label="关闭">
                    <X className="size-3.5" />
                </button>
            </div>
            <div className="grid gap-0.5">
                {definitions.map((def) => (
                    <ConnectionCreateOption key={def.type} theme={theme} icon={def.icon} title={def.title} description={def.description} accent={nodeCreateMenuAccent(def.type)} onClick={() => onCreate(def.type)} />
                ))}
            </div>
        </div>
    );
}

function EmptyCanvasGuide({ onCreate }: { onCreate: (type: CanvasNodeType) => void }) {
    const actions = [
        { type: CanvasNodeType.Text, title: "文字创作", description: "先写下想法或脚本", accent: "#fbbf24", icon: <Type className="size-5" />, art: <Type className="size-16" /> },
        { type: CanvasNodeType.Image, title: "生成图片", description: "从描述开始构图", accent: "#67e8f9", icon: <ImageIcon className="size-5" />, art: <ImageIcon className="size-16" /> },
        { type: CanvasNodeType.Video, title: "生成视频", description: "让画面动起来", accent: "#a78bfa", icon: <Video className="size-5" />, art: <Video className="size-16" /> },
        { type: CanvasNodeType.AssetExtraction, title: "资产提取", description: "从内容中整理资产", accent: "#34d399", icon: <ScanText className="size-5" />, art: <ScanText className="size-16" /> },
    ];
    return (
        <div data-canvas-no-zoom className="pointer-events-auto w-[min(1160px,calc(100vw-64px))] text-white" onPointerDown={(event) => event.stopPropagation()}>
            <div className="mb-7 flex flex-col items-center text-center">
                <div className="flex items-center gap-3 text-[22px] font-semibold tracking-tight"><MousePointer2 className="size-5 text-sky-300" />双击画布，自由生成节点</div>
                <p className="mt-2 text-sm text-slate-300">从一个节点开始，把文字、图片、视频和资产提取串成创作流程</p>
            </div>
            <div className="grid grid-cols-4 gap-4">
                {actions.map((action) => (
                    <button
                        key={action.type}
                        type="button"
                        className="group relative flex h-[112px] min-w-0 items-center gap-3 overflow-hidden rounded-xl border border-[#33466b] bg-[#111c37] px-4 text-left shadow-[0_12px_30px_rgba(0,0,0,.16)] transition duration-200 hover:-translate-y-0.5 hover:border-sky-300/70 hover:bg-[#172645]"
                        onClick={() => onCreate(action.type)}
                    >
                        <span className="relative z-10 grid size-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[.09] transition group-hover:bg-white/[.16]" style={{ color: action.accent }}>{action.icon}</span>
                        <span className="relative z-10 min-w-0">
                            <span className="block truncate text-base font-medium">{action.title}</span>
                            <span className="mt-1 block truncate text-xs text-slate-300">{action.description}</span>
                        </span>
                        <span className="pointer-events-none absolute bottom-2 right-3 opacity-[.1] transition duration-300 group-hover:scale-105 group-hover:opacity-[.18]" style={{ color: action.accent }}>{action.art}</span>
                        <ArrowUpRight className="absolute right-3 top-3 size-4 text-slate-500 transition group-hover:text-sky-200" />
                    </button>
                ))}
            </div>
        </div>
    );
}

function InfiniteCanvasPage() {
    const { message, modal } = App.useApp();
    // 订阅节点注册表版本,插件动态注册/卸载后驱动画布重渲染
    const nodeRegistryVersion = useNodeRegistryVersion((state) => state.version);
    const params = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const projectId = params.id || "";
    const localAgentConnected = useAgentStore((state) => state.connected);
    const localAgentActivity = useAgentStore((state) => state.activity);
    const localAgentEnabled = useAgentStore((state) => state.enabled);
    const agentPanelOpen = useAgentStore((state) => state.panelOpen);
    const toggleAgentPanel = useAgentStore((state) => state.togglePanel);
    const openAgentPanel = useAgentStore((state) => state.openPanel);
    const setAgentCanvasContext = useAgentStore((state) => state.setCanvasContext);
    const containerRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<{ nodeId?: string; position?: Position } | null>(null);
    const clipboardRef = useRef<CanvasClipboard | null>(null);
    const historyRef = useRef<{ past: CanvasHistoryEntry[]; future: CanvasHistoryEntry[] }>({ past: [], future: [] });
    const lastHistoryRef = useRef<CanvasHistoryEntry | null>(null);
    const historyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const projectCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const applyingHistoryRef = useRef(false);
    const historyPausedRef = useRef(false);
    const didInitialCenterRef = useRef(false);
    const rafRef = useRef<number | null>(null);
    const nodeDraggingRef = useRef(false);
    const dragRef = useRef<NodeDragState>({
        isDraggingNode: false,
        hasMoved: false,
        startX: 0,
        startY: 0,
        previewDx: 0,
        previewDy: 0,
        initialSelectedNodes: [],
        initialById: new Map(),
        movedIds: new Set(),
        nodeById: new Map(),
        nodeElements: new Map(),
        connectionElements: [],
    });

    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const localAssets = useAssetStore((state) => state.assets);
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const createProject = useCanvasStore((state) => state.createProject);
    const openProject = useCanvasStore((state) => state.openProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const currentProjectTitle = useCanvasStore((state) => state.projects.find((project) => project.id === projectId)?.title);
    const userConnection = useUserStore((state) => state.connection);
    const userAssets = useUserStore((state) => state.assets);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [size, setSize] = useState({ width: 1200, height: 720 });
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [connectingParams, setConnectingParams] = useState<ConnectionHandle | null>(null);
    const [batchConnectingParams, setBatchConnectingParams] = useState<ConnectionHandle[] | null>(null);
    const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null);
    const [pendingConnectionCreate, setPendingConnectionCreate] = useState<PendingConnectionCreate | null>(null);
    const [mouseWorld, setMouseWorld] = useState<Position>({ x: 0, y: 0 });
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [nodeCreatePosition, setNodeCreatePosition] = useState<Position | null>(null);
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
    const [isMiniMapOpen, setIsMiniMapOpen] = useState(false);
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("lines");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [panMode, setPanMode] = useState(false);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [projectLoaded, setProjectLoaded] = useState(false);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [nodeImageSettingsOpen, setNodeImageSettingsOpen] = useState(false);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editRequestNonce, setEditRequestNonce] = useState(0);
    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
    const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
    const [cropNodeId, setCropNodeId] = useState<string | null>(null);
    const [maskEditNodeId, setMaskEditNodeId] = useState<string | null>(null);
    const [splitNodeId, setSplitNodeId] = useState<string | null>(null);
    const [upscaleNodeId, setUpscaleNodeId] = useState<string | null>(null);
    const [superResolveNodeId, setSuperResolveNodeId] = useState<string | null>(null);
    const [angleNodeId, setAngleNodeId] = useState<string | null>(null);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [agentUndoSnapshot, setAgentUndoSnapshot] = useState<CanvasAgentSnapshot | null>(null);
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const [collapsingBatchIds, setCollapsingBatchIds] = useState<Set<string>>(new Set());
    const [openingBatchIds, setOpeningBatchIds] = useState<Set<string>>(new Set());
    const [isNodeDragging, setIsNodeDragging] = useState(false);
    const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);
    const [textSelections, setTextSelections] = useState<Record<string, string>>({});

    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);
    const generateNodeRef = useRef<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options?: CanvasNodeGenerationOptions) => Promise<void>) | null>(null);
    const connectingParamsRef = useRef(connectingParams);
    const batchConnectingRef = useRef<ConnectionHandle[] | null>(batchConnectingParams);
    const batchPointerStartRef = useRef({ x: 0, y: 0 });
    const batchDidMoveRef = useRef(false);
    const suppressBatchConnectClickRef = useRef(false);
    const connectionTargetNodeIdRef = useRef(connectionTargetNodeId);
    const selectionBoxRef = useRef(selectionBox);
    const pendingConnectionCreateRef = useRef(pendingConnectionCreate);
    const generationRequestsRef = useRef(new Map<string, CanvasGenerationRequest>());
    const resumedAudioTaskIdsRef = useRef(new Set<string>());
    const resumedVideoTaskIdsRef = useRef(new Set<string>());
    const pausedVideoTaskIdsRef = useRef(new Set<string>());
    const projectSnapshotRef = useRef({ nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo });
    projectSnapshotRef.current = { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo };

    const createHistoryEntry = useCallback(
        (): CanvasHistoryEntry => ({
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            chatSessions,
            activeChatId,
            backgroundMode,
            showImageInfo,
        }),
        [activeChatId, backgroundMode, chatSessions, showImageInfo],
    );

    const cleanupCanvasFiles = useCallback(
        (extra?: unknown) => {
            cleanupAssetImages({ extra, history: historyRef.current, lastHistory: lastHistoryRef.current });
        },
        [cleanupAssetImages],
    );

    const startGenerationRequest = useCallback((targetNodeId: string, originNodeId: string, runningId = originNodeId, controller = new AbortController()) => {
        const previous = generationRequestsRef.current.get(targetNodeId);
        if (previous?.controller !== controller) {
            previous?.controller.abort();
            if (previous) useCanvasHostTaskStore.getState().finishTask(previous.taskId, "cancelled");
        }
        const taskId = `canvas-${projectId}-${targetNodeId}-${Date.now()}`;
        const targetNode = nodesRef.current.find((node) => node.id === targetNodeId)
            || nodesRef.current.find((node) => node.id === originNodeId);
        useCanvasHostTaskStore.getState().startTask({
            id: taskId,
            projectId,
            projectTitle: currentProjectTitle || "未命名画布",
            nodeId: targetNodeId,
            title: targetNode?.title || "画布 AI 生成",
            stage: canvasTaskStage(targetNode),
        });
        generationRequestsRef.current.set(targetNodeId, { targetNodeId, originNodeId, runningNodeId: runningId, controller, taskId });
        return controller;
    }, [currentProjectTitle, projectId]);

    const finishGenerationRequest = useCallback((targetNodeId: string, controller: AbortController) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (request?.controller !== controller) return;
        generationRequestsRef.current.delete(targetNodeId);
        if (controller.signal.aborted) {
            useCanvasHostTaskStore.getState().finishTask(request.taskId, "cancelled");
            return;
        }
        window.setTimeout(() => {
            const node = nodesRef.current.find((item) => item.id === targetNodeId);
            const failed = node?.metadata?.status === NODE_STATUS_ERROR;
            useCanvasHostTaskStore.getState().finishTask(
                request.taskId,
                failed ? "failed" : "succeeded",
                failed ? node.metadata?.errorDetails : undefined,
            );
        }, 0);
    }, []);

    const updateVideoHostTask = useCallback((targetNodeId: string, task: CanvasVideoTask) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (!request) return;
        const phase = task.statusMessage || (task.archiveStatus === "archiving" ? "视频归档中" : task.status === "queued" ? "视频排队中" : task.status === "submission_unknown" ? "提交结果未知，请勿重复生成" : task.status === "completed" ? "视频已完成" : task.status === "failed" ? "视频生成失败" : "视频生成中");
        const billing = task.billingStatus === "refunded" ? "已退款" : "";
        useCanvasHostTaskStore.getState().updateTask(request.taskId, { progress: task.progress, stage: [phase, billing].filter(Boolean).join(" · ") });
    }, []);

    const stopGenerationByRunningId = useCallback(
        (runningId: string) => {
        const affectedNodeIds = new Set<string>();
        generationRequestsRef.current.forEach((request) => {
            if (request.runningNodeId !== runningId) return;
            const node = nodesRef.current.find((item) => item.id === request.targetNodeId);
            if (node?.metadata?.videoTaskId) {
                pausedVideoTaskIdsRef.current.add(node.metadata.videoTaskId);
                if (node.metadata.videoCanCancel) {
                    const generationConfig = buildGenerationConfig(effectiveConfig, node, "video");
                    void cancelQueuedCanvasVideoTask(generationConfig, node.metadata.videoTaskId)
                        .then(() => message.success("排队任务已取消，钱包冻结金额已释放"))
                        .catch(() => undefined);
                }
            }
            if (node?.metadata?.sourceType === "tts" && node.metadata.audioTaskId) {
                const generationConfig = buildGenerationConfig(effectiveConfig, node, "audio");
                void cancelCanvasAudioTask(generationConfig, node.metadata.audioTaskId).catch(() => undefined);
            }
            request.controller.abort();
            generationRequestsRef.current.delete(request.targetNodeId);
            useCanvasHostTaskStore.getState().finishTask(request.taskId, "cancelled");
            affectedNodeIds.add(request.targetNodeId);
            affectedNodeIds.add(request.originNodeId);
        });
        setRunningNodeId((current) => (current === runningId ? null : current));
        if (!affectedNodeIds.size) return;
            setNodes((prev) => prev.map((node) => (affectedNodeIds.has(node.id) && node.metadata?.status === NODE_STATUS_LOADING ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } } : node)));
        },
        [effectiveConfig, message],
        );

    const confirmStopGeneration = useCallback(
        (nodeId: string) => {
            const videoNode = nodesRef.current.find((node) => node.id === nodeId && node.metadata?.videoProvider === "canvas-video");
            const waitingForServerVideo = Boolean(videoNode);
            const canCancelQueuedVideo = Boolean(videoNode?.metadata?.videoCanCancel);
            modal.confirm({
                title: canCancelQueuedVideo ? "取消排队？" : waitingForServerVideo ? "停止等待？" : "停止生成？",
                content: canCancelQueuedVideo ? "任务尚未提交上游，取消后会立即释放钱包冻结金额。" : waitingForServerVideo ? "视频会继续在服务器生成和归档，重新进入画布后可恢复结果。" : "当前生成请求会被中断，已经生成完成的内容会保留。",
                okText: canCancelQueuedVideo ? "取消排队" : waitingForServerVideo ? "停止等待" : "停止",
                cancelText: waitingForServerVideo ? "继续等待" : "继续生成",
                okButtonProps: { danger: true },
                onOk: () => stopGenerationByRunningId(nodeId),
            });
        },
        [modal, stopGenerationByRunningId],
    );

    useEffect(() => {
        if (!hydrated) return;
        setProjectLoaded(false);
        const project = openProject(projectId);
        if (!project) {
            navigate("/canvas", { replace: true });
            return;
        }

        let cancelled = false;
        const restore = () => {
            const obsoleteGridIds = new Set(project.nodes.filter((node) => node.type === "storyboard-grid").map((node) => node.id));
            const obsoleteGridGroupIds = new Set(
                project.nodes
                    .filter((node) => obsoleteGridIds.has(String((node.metadata as Record<string, unknown> | undefined)?.storyboardGridNodeId || "")))
                    .map((node) => node.id),
            );
            const removedNodeIds = new Set(
                project.nodes
                    .filter((node) => {
                        const metadata = node.metadata as Record<string, unknown> | undefined;
                        // 剧本集/分镜脚本节点已下线；旧项目恢复时一并丢弃，避免历史数据重新渲染成未知节点。
                        return node.type === "config" || node.type === "script-set" || node.type === "storyboard" || node.type === "storyboard-grid" || obsoleteGridIds.has(String(metadata?.storyboardGridNodeId || "")) || obsoleteGridGroupIds.has(String(metadata?.storyboardGridImageGroupId || ""));
                    })
                    .map((node) => node.id),
            );
            // Render the persisted graph immediately. Remote media resolution and
            // one-time local backfills happen after the canvas is interactive.
            const baseNodes = resetInterruptedGeneration(project.nodes.filter((node) => !removedNodeIds.has(node.id)));
            const restoredConnections = project.connections.filter((connection) => !removedNodeIds.has(connection.fromNodeId) && !removedNodeIds.has(connection.toNodeId));
            const baseSessions = project.chatSessions || [];
            setNodes(baseNodes);
            setConnections(restoredConnections);
            setChatSessions(baseSessions);
            setActiveChatId(project.activeChatId || null);
            setBackgroundMode(project.backgroundMode);
            setShowImageInfo(project.showImageInfo || false);
            setViewport(project.viewport);
            historyRef.current = { past: [], future: [] };
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
            lastHistoryRef.current = {
                nodes: baseNodes,
                connections: restoredConnections,
                chatSessions: baseSessions,
                activeChatId: project.activeChatId || null,
                backgroundMode: project.backgroundMode,
                showImageInfo: project.showImageInfo || false,
            };
            setHistoryState({ canUndo: false, canRedo: false });
            setProjectLoaded(true);
            void hydrateCanvasImages(baseNodes).then((hydratedNodes) => {
                if (cancelled) return;
                const hydratedById = new Map(hydratedNodes.map((node) => [node.id, node]));
                const baseById = new Map(baseNodes.map((node) => [node.id, node]));
                setNodes((currentNodes) => {
                    const nextNodes = currentNodes.map((node) => (baseById.get(node.id) === node ? hydratedById.get(node.id) || node : node));
                    nodesRef.current = nextNodes;
                    if (lastHistoryRef.current) lastHistoryRef.current = { ...lastHistoryRef.current, nodes: nextNodes };
                    return nextNodes;
                });
            }).catch(() => undefined);
            void hydrateAssistantImages(baseSessions).then((hydratedSessions) => {
                if (cancelled) return;
                const hydratedById = new Map(hydratedSessions.map((session) => [session.id, session]));
                const baseById = new Map(baseSessions.map((session) => [session.id, session]));
                setChatSessions((currentSessions) => {
                    const nextSessions = currentSessions.map((session) => (baseById.get(session.id) === session ? hydratedById.get(session.id) || session : session));
                    if (lastHistoryRef.current) lastHistoryRef.current = { ...lastHistoryRef.current, chatSessions: nextSessions };
                    return nextSessions;
                });
            }).catch(() => undefined);
        };
        restore();
        return () => {
            cancelled = true;
        };
    }, [hydrated, navigate, openProject, projectId]);

    useEffect(() => {
        if (!SHOW_AGENT_UI || !projectLoaded || !["new", "recent", "choose"].includes(searchParams.get("mode") || "")) return;
        if (!searchParams.has("agentUrl")) openAgentPanel();
    }, [openAgentPanel, projectLoaded, searchParams]);

    useEffect(() => {
        if (!projectLoaded || applyingHistoryRef.current || historyPausedRef.current) return;
        const next = createHistoryEntry();
        const previous = lastHistoryRef.current;
        if (
            previous?.nodes === next.nodes &&
            previous.connections === next.connections &&
            previous.chatSessions === next.chatSessions &&
            previous.activeChatId === next.activeChatId &&
            previous.backgroundMode === next.backgroundMode &&
            previous.showImageInfo === next.showImageInfo
        )
            return;

        if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = setTimeout(() => {
            const current = createHistoryEntry();
            const last = lastHistoryRef.current;
            if (!last) return;
            historyRef.current.past = [...historyRef.current.past.slice(-49), last];
            historyRef.current.future = [];
            setHistoryState({ canUndo: true, canRedo: false });
            lastHistoryRef.current = current;
            historyCommitTimerRef.current = null;
        }, 180);

        return () => {
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
        };
    }, [activeChatId, backgroundMode, chatSessions, connections, createHistoryEntry, nodes, projectLoaded, showImageInfo]);

    const commitProjectSnapshot = useCallback(() => {
        if (!projectLoaded || historyPausedRef.current) return;
        updateProject(projectId, projectSnapshotRef.current);
    }, [projectId, projectLoaded, updateProject]);

    const syncProjectSnapshot = useCallback(
        async (patch?: Partial<typeof projectSnapshotRef.current>) => {
            updateProject(projectId, { ...projectSnapshotRef.current, ...patch });
            await syncSucaiCanvasProject(projectId);
        },
        [projectId, updateProject],
    );

    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current) return;
        if (projectCommitTimerRef.current) clearTimeout(projectCommitTimerRef.current);
        projectCommitTimerRef.current = setTimeout(() => {
            projectCommitTimerRef.current = null;
            commitProjectSnapshot();
        }, 250);
        return () => {
            if (projectCommitTimerRef.current) clearTimeout(projectCommitTimerRef.current);
        };
    }, [activeChatId, backgroundMode, chatSessions, commitProjectSnapshot, connections, nodes, projectLoaded, showImageInfo]);

    useEffect(
        () => () => {
            if (projectCommitTimerRef.current) clearTimeout(projectCommitTimerRef.current);
            commitProjectSnapshot();
            queueMicrotask(() => void flushCanvasPersistence());
        },
        [commitProjectSnapshot],
    );

    useEffect(() => {
        if (!dialogNodeId) setNodeImageSettingsOpen(false);
    }, [dialogNodeId]);

    useEffect(() => {
        if (!dialogNodeId) return;
        const timer = window.setTimeout(() => {
            const panel = Array.from(document.querySelectorAll<HTMLElement>("[data-canvas-node-panel]")).find((element) => element.dataset.canvasNodePanel === dialogNodeId);
            const dock = document.querySelector<HTMLElement>("[data-canvas-toolbar-dock]");
            const container = containerRef.current;
            if (!panel || !container) return;

            const panelRect = panel.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const dockRect = dock?.getBoundingClientRect();
            const overlapsDockHorizontally = Boolean(dockRect && panelRect.left < dockRect.right && panelRect.right > dockRect.left);
            const safeBottom = Math.min(containerRect.bottom - 16, overlapsDockHorizontally && dockRect ? dockRect.top - 12 : Number.POSITIVE_INFINITY);
            const overflow = panelRect.bottom - safeBottom;
            if (overflow <= 0) return;

            setViewport((current) => {
                const next = { ...current, y: current.y - Math.ceil(overflow) };
                viewportRef.current = next;
                return next;
            });
        }, 140);
        return () => window.clearTimeout(timer);
    }, [dialogNodeId, size.height, size.width, viewport.k]);

    useEffect(() => {
        if (!projectLoaded) return;
        if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = setTimeout(() => {
            updateProject(projectId, { viewport: viewportRef.current });
            viewportSaveTimerRef.current = null;
        }, 500);
        return () => {
            if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        };
    }, [projectId, projectLoaded, updateProject, viewport]);

    useEffect(() => {
        if (!projectLoaded) return;
        nodes.forEach((node) => {
            const taskId = node.metadata?.audioTaskId;
            if (node.type !== CanvasNodeType.Audio || node.metadata?.sourceType !== "tts" || node.metadata?.status !== NODE_STATUS_LOADING || !taskId) return;
            if (resumedAudioTaskIdsRef.current.has(taskId) || generationRequestsRef.current.has(node.id)) return;
            resumedAudioTaskIdsRef.current.add(taskId);
            const generationConfig = buildGenerationConfig(effectiveConfig, node, "audio");
            const controller = startGenerationRequest(node.id, node.id, node.id);
            void pollCanvasAudioTask(generationConfig, taskId, controller.signal)
                .then((result) => storeGeneratedAudio(result, generationConfig.audioFormat))
                .then((audio) => {
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...audioMetadata(audio, "tts"), errorDetails: undefined } } : item)));
                    playGenerationCompleteSound();
                })
                .catch((error) => {
                    if (isGenerationCanceled(error)) return;
                    const errorDetails = error instanceof Error ? error.message : "配音任务恢复失败";
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
                })
                .finally(() => finishGenerationRequest(node.id, controller));
        });
    }, [effectiveConfig, finishGenerationRequest, nodes, projectLoaded, startGenerationRequest]);

    useEffect(() => {
        if (!projectLoaded) return;
        nodes.forEach((node) => {
            const taskId = node.metadata?.videoTaskId;
            if (node.type !== CanvasNodeType.Video || node.metadata?.content || !taskId) return;
            if (pausedVideoTaskIdsRef.current.has(taskId) || resumedVideoTaskIdsRef.current.has(taskId) || generationRequestsRef.current.has(node.id)) return;
            resumedVideoTaskIdsRef.current.add(taskId);
            const generationConfig = buildGenerationConfig(effectiveConfig, node, "video");
            const controller = startGenerationRequest(node.id, node.id, node.id);
            setNodes((prev) => prev.map((item) => item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } } : item));
            void waitForCanvasVideoTask(generationConfig, taskId, controller.signal, (task) => {
                updateVideoHostTask(node.id, task);
                setNodes((prev) => prev.map((item) => item.id === node.id ? { ...item, metadata: { ...item.metadata, ...canvasVideoTaskMetadata(task) } } : item));
            })
                .then((video) => {
                    const size = fitNodeSize(video.width || node.width, video.height || node.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) => prev.map((item) => item.id === node.id ? {
                        ...item,
                        width: size.width,
                        height: size.height,
                        position: { x: item.position.x + item.width / 2 - size.width / 2, y: item.position.y + item.height / 2 - size.height / 2 },
                        metadata: { ...item.metadata, ...canvasVideoMetadata(video), errorDetails: undefined },
                    } : item));
                    playGenerationCompleteSound();
                })
                .catch((error) => {
                    if (isGenerationCanceled(error)) return;
                    const errorDetails = error instanceof Error ? error.message : "视频任务恢复失败";
                    setNodes((prev) => prev.map((item) => item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item));
                })
                .finally(() => finishGenerationRequest(node.id, controller));
        });
    }, [effectiveConfig, finishGenerationRequest, nodes, projectLoaded, startGenerationRequest, updateVideoHostTask]);

    useLayoutEffect(() => {
        nodesRef.current = nodes;
        connectionsRef.current = connections;
        selectedNodeIdsRef.current = selectedNodeIds;
        viewportRef.current = viewport;
        connectingParamsRef.current = connectingParams;
        batchConnectingRef.current = batchConnectingParams;
        connectionTargetNodeIdRef.current = connectionTargetNodeId;
        pendingConnectionCreateRef.current = pendingConnectionCreate;
    }, [batchConnectingParams, nodes, connections, selectedNodeIds, viewport, connectingParams, connectionTargetNodeId, pendingConnectionCreate]);

    useLayoutEffect(() => {
        selectionBoxRef.current = selectionBox;
    }, [selectionBox]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const updateSize = () => {
            const rect = el.getBoundingClientRect();
            setSize({ width: rect.width, height: rect.height });
            if (!didInitialCenterRef.current) {
                didInitialCenterRef.current = true;
                setViewport({ x: rect.width / 2, y: rect.height / 2, k: 1 });
            }
        };

        updateSize();
        const resizeObserver = new ResizeObserver(updateSize);
        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, []);

    const screenToCanvas = useCallback((clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        const currentViewport = viewportRef.current;
        const localX = clientX - (rect?.left || 0);
        const localY = clientY - (rect?.top || 0);

        return {
            x: (localX - currentViewport.x) / currentViewport.k,
            y: (localY - currentViewport.y) / currentViewport.k,
        };
    }, []);

    const getCanvasCenter = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        return screenToCanvas((rect?.left || 0) + (rect?.width || size.width) / 2, (rect?.top || 0) + (rect?.height || size.height) / 2);
    }, [screenToCanvas, size.height, size.width]);

    useEffect(() => {
        const stopListening = onCanvasEvent("canvas-fit-node", (payload) => {
            const detail = payload as { nodeId?: string; width?: number; height?: number; padding?: number };
            const node = nodesRef.current.find((item) => item.id === detail.nodeId);
            const rect = containerRef.current?.getBoundingClientRect();
            if (!node || !rect) return;
            const width = detail.width || node.width;
            const height = detail.height || node.height;
            const padding = detail.padding ?? 48;
            const scale = Math.min(1, Math.max(0.2, (rect.width - padding * 2) / width), Math.max(0.2, (rect.height - padding * 2) / height));
            const next = {
                x: rect.width / 2 - (node.position.x + width / 2) * scale,
                y: rect.height / 2 - (node.position.y + height / 2) * scale,
                k: scale,
            };
            viewportRef.current = next;
            setViewport(next);
        });
        return () => {
            stopListening();
        };
    }, []);

    const setConnecting = useCallback((next: ConnectionHandle | null) => {
        connectingParamsRef.current = next;
        setConnectingParams(next);
        if (!next) {
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
        }
    }, []);

    const keepNodeToolbar = useCallback(
        (nodeId: string) => {
        if (nodeDraggingRef.current || nodeImageSettingsOpen || !selectedNodeIdsRef.current.has(nodeId)) return;
        setToolbarNodeId(nodeId);
        },
        [nodeImageSettingsOpen],
    );

    const hideNodeToolbar = useCallback(() => {}, []);

    const connectNodes = useCallback(
        (current: ConnectionHandle, targetNodeId: string) => {
            if (current.nodeId === targetNodeId) return;

            const connection = normalizeConnection(current.nodeId, targetNodeId, nodesRef.current, current.handleType);
            if (!connection) return;
            const { fromNodeId, toNodeId } = connection;
            const exists = connectionsRef.current.some((conn) => conn.fromNodeId === fromNodeId && conn.toNodeId === toNodeId);
            if (!exists) {
                const nextConnections = [...connectionsRef.current, { id: `conn-${Date.now()}`, fromNodeId, toNodeId }];
                connectionsRef.current = nextConnections;
                setConnections(nextConnections);
                setNodes((prev) => prev.map((node) => node.id === toNodeId ? { ...node, metadata: { ...node.metadata, referenceOrder: mergeCanvasReferenceOrder(toNodeId, prev, nextConnections) } } : node));
            }
            setContextMenu(null);
        },
        [],
    );

    const connectMultipleNodes = useCallback((handles: ConnectionHandle[], targetNodeId: string) => {
        const nextConnectionKeys = new Set(connectionsRef.current.map((connection) => `${connection.fromNodeId}:${connection.toNodeId}`));
        const createdConnections = handles.flatMap((handle) => {
            const connection = normalizeConnection(handle.nodeId, targetNodeId, nodesRef.current, handle.handleType);
            if (!connection) return [];
            const key = `${connection.fromNodeId}:${connection.toNodeId}`;
            if (nextConnectionKeys.has(key)) return [];
            nextConnectionKeys.add(key);
            return [{ id: nanoid(), ...connection }];
        });
        if (createdConnections.length) {
            const nextConnections = [...connectionsRef.current, ...createdConnections];
            connectionsRef.current = nextConnections;
            setConnections(nextConnections);
            const target = nodesRef.current.find((node) => node.id === targetNodeId);
            if (target) setNodes((prev) => prev.map((node) => node.id === targetNodeId ? { ...node, metadata: { ...node.metadata, referenceOrder: mergeCanvasReferenceOrder(targetNodeId, prev, nextConnections) } } : node));
        }
        setContextMenu(null);
    }, []);

    const createConnectedNode = useCallback(
        (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Video | CanvasNodeType.Audio, pending: PendingConnectionCreate) => {
            const metadata =
                type === CanvasNodeType.Audio
                      ? {
                            sourceType: "tts" as const,
                            model: effectiveConfig.audioModel,
                            audioVoice: effectiveConfig.audioVoice,
                            audioVoiceName: effectiveConfig.audioVoiceName,
                            audioFormat: effectiveConfig.audioFormat,
                            audioSpeed: effectiveConfig.audioSpeed,
                            audioInstructions: effectiveConfig.audioInstructions,
                        }
                  : undefined;
            const createdNode = createCanvasNode(type, pending.position, metadata);
            const newNode = type === CanvasNodeType.Audio ? { ...createdNode, title: "配音" } : createdNode;
            const nextConnectionKeys = new Set(connectionsRef.current.map((connection) => `${connection.fromNodeId}:${connection.toNodeId}`));
            const createdConnections = pending.connections.flatMap((current) => {
                const connection = normalizeConnection(current.nodeId, newNode.id, [...nodesRef.current, newNode], current.handleType);
                if (!connection) return [];
                const key = `${connection.fromNodeId}:${connection.toNodeId}`;
                if (nextConnectionKeys.has(key)) return [];
                nextConnectionKeys.add(key);
                return [{ id: nanoid(), ...connection }];
            });
            if (!createdConnections.length) return;
            const nextConnections = [...connectionsRef.current, ...createdConnections];
            connectionsRef.current = nextConnections;
            const nextNodes = [...nodesRef.current, { ...newNode, metadata: { ...newNode.metadata, referenceOrder: mergeCanvasReferenceOrder(newNode.id, [...nodesRef.current, newNode], nextConnections) } }];
            nodesRef.current = nextNodes;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(newNode.id);
            setPendingConnectionCreate(null);
            setConnecting(null);
        },
        [
            effectiveConfig.audioFormat,
            effectiveConfig.audioInstructions,
            effectiveConfig.audioModel,
            effectiveConfig.audioSpeed,
            effectiveConfig.audioVoice,
            effectiveConfig.audioVoiceName,
            effectiveConfig.canvasImageCount,
            effectiveConfig.count,
            effectiveConfig.imageModel,
            effectiveConfig.model,
            effectiveConfig.size,
            message,
            setConnecting,
        ],
    );

    const cancelPendingConnectionCreate = useCallback(() => {
        setPendingConnectionCreate(null);
        batchConnectingRef.current = null;
        setBatchConnectingParams(null);
        setConnecting(null);
    }, [setConnecting]);

    const handleBatchConnectionStart = useCallback(
        (event: ReactPointerEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            const sourceNodes = nodesRef.current.filter((node) => selectedNodeIdsRef.current.has(node.id) && node.type !== CanvasNodeType.Group && (getNodeDefinition(node.type)?.hasSourceHandle ?? true));
            if (sourceNodes.length < 2) return;
            const handles = sourceNodes.map((node) => ({ nodeId: node.id, handleType: "source" as const }));
            batchPointerStartRef.current = { x: event.clientX, y: event.clientY };
            batchDidMoveRef.current = false;
            suppressBatchConnectClickRef.current = false;
            batchConnectingRef.current = handles;
            setBatchConnectingParams(handles);
            setConnecting(null);
            setConnectionTargetNodeId(null);
            setMouseWorld(screenToCanvas(event.clientX, event.clientY));
        },
        [screenToCanvas, setConnecting],
    );

    const startBatchConnectionCreate = useCallback(
        (event: ReactMouseEvent<HTMLButtonElement>) => {
            event.preventDefault();
            event.stopPropagation();
            const sourceNodes = nodesRef.current.filter((node) => selectedNodeIdsRef.current.has(node.id) && node.type !== CanvasNodeType.Group && (getNodeDefinition(node.type)?.hasSourceHandle ?? true));
            if (sourceNodes.length < 2) return;
            const bounds = nodeBounds(sourceNodes);
            const currentViewport = viewportRef.current;
            const scale = Math.max(currentViewport.k, 0.05);
            const centerY = (bounds.top + bounds.bottom) / 2;
            const anchorPosition = { x: bounds.right + 30 / scale, y: centerY };
            const viewLeft = -currentViewport.x / scale;
            const viewTop = -currentViewport.y / scale;
            const viewRight = (size.width - currentViewport.x) / scale;
            const viewBottom = (size.height - currentViewport.y) / scale;
            const menuWidth = 292 / scale;
            const menuHeight = 236 / scale;
            const edgePadding = 12 / scale;
            let menuX = anchorPosition.x + 30 / scale;
            if (menuX + menuWidth > viewRight - edgePadding) menuX = anchorPosition.x - menuWidth - 30 / scale;
            menuX = Math.max(viewLeft + edgePadding, Math.min(menuX, viewRight - menuWidth - edgePadding));
            const menuY = Math.max(viewTop + edgePadding, Math.min(centerY - menuHeight / 2, viewBottom - menuHeight - edgePadding));
            setNodeCreatePosition(null);
            setConnecting(null);
            setPendingConnectionCreate({
                connections: sourceNodes.map((node) => ({ nodeId: node.id, handleType: "source" as const })),
                anchorPosition,
                menuPosition: { x: menuX, y: menuY },
                position: { x: bounds.right + 250 / scale, y: centerY },
            });
        },
        [setConnecting, size.height, size.width],
    );

    const getConnectionDropTarget = useCallback(
        (clientX: number, clientY: number, current: ConnectionHandle): ConnectionDropTarget => {
            const world = screenToCanvas(clientX, clientY);
            const scale = Math.max(viewportRef.current.k, 0.05);
            const padding = CONNECTION_NODE_HIT_PADDING / scale;
            const handleRadius = CONNECTION_HANDLE_HIT_RADIUS / scale;
            let isNearNode = false;
            let bestNodeId: string | null = null;
            let bestPriority = Number.POSITIVE_INFINITY;

            [...nodesRef.current]
                .filter((node) => !isHiddenBatchChild(node, nodesRef.current))
                .reverse()
                .forEach((node) => {
                    const anchor = getConnectionTargetAnchor(node, current);
                    const dx = world.x - anchor.x;
                    const dy = world.y - anchor.y;
                    const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
                    const hitsInside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
                    const hitsExpanded = world.x >= node.position.x - padding && world.x <= node.position.x + node.width + padding && world.y >= node.position.y - padding && world.y <= node.position.y + node.height + padding;

                    if (!hitsHandle && !hitsInside && !hitsExpanded) return;
                    isNearNode = true;
                    if (node.id === current.nodeId || !normalizeConnection(current.nodeId, node.id, nodesRef.current, current.handleType)) return;

                    const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
                    if (priority < bestPriority) {
                        bestNodeId = node.id;
                        bestPriority = priority;
                    }
                });

            return { nodeId: bestNodeId, isNearNode };
        },
        [screenToCanvas],
    );

    const geometryNodesRef = useRef<CanvasNodeData[]>([]);
    const geometryNodes = useMemo(() => {
        if (!sameNodeGeometry(geometryNodesRef.current, nodes)) geometryNodesRef.current = nodes;
        return geometryNodesRef.current;
    }, [nodes]);
    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const graphStructure = useMemo(() => createCanvasGraphIndex(geometryNodes, connections), [connections, geometryNodes]);
    const graphIndex = useMemo(() => ({ ...graphStructure, nodeById }), [graphStructure, nodeById]);
    const geometryNodeById = useMemo(() => new Map(geometryNodes.map((node) => [node.id, node])), [geometryNodes]);
    const nodeSpatialIndex = useMemo(
        () => createCanvasSpatialIndex(geometryNodes.map((node) => ({
            bounds: {
                left: node.position.x,
                top: node.position.y,
                right: node.position.x + node.width,
                bottom: node.position.y + node.height,
            },
            value: node,
        }))),
        [geometryNodes],
    );
    const connectionSpatialIndex = useMemo(
        () => createCanvasSpatialIndex(connections.flatMap((connection) => {
            const from = geometryNodeById.get(connection.fromNodeId);
            const to = geometryNodeById.get(connection.toNodeId);
            return from && to ? [{ bounds: getConnectionBounds(from, to), value: connection }] : [];
        })),
        [connections, geometryNodeById],
    );
    const canvasViewBounds = useMemo(() => {
        const padding = 280;
        const rect = containerRef.current?.getBoundingClientRect();
        const width = rect?.width || size.width;
        const height = rect?.height || size.height;
        const viewLeft = -viewport.x / viewport.k - padding;
        const viewTop = -viewport.y / viewport.k - padding;
        const viewRight = viewLeft + width / viewport.k + padding * 2;
        const viewBottom = viewTop + height / viewport.k + padding * 2;

        return { left: viewLeft, top: viewTop, right: viewRight, bottom: viewBottom };
    }, [size.height, size.width, viewport.k, viewport.x, viewport.y]);

    const visibleConnections = useMemo(
        () =>
            connectionSpatialIndex.query(canvasViewBounds).filter((connection) => {
                const from = nodeById.get(connection.fromNodeId);
                const to = nodeById.get(connection.toNodeId);
                if (!from || !to || isHiddenBatchConnectionEndpoint(from, nodeById) || isHiddenBatchConnectionEndpoint(to, nodeById)) return false;
                return true;
            }),
        [canvasViewBounds, connectionSpatialIndex, nodeById],
    );
    // Nodes and connections must share one visibility boundary. A connection can
    // enter the padded viewport before its endpoint does; keep both endpoints in
    // the render set so the edge never appears detached from its node.
    const visibleNodeIds = useMemo(() => {
        const ids = new Set(nodeSpatialIndex.query(canvasViewBounds).map((node) => node.id));
        visibleConnections.forEach((connection) => {
            ids.add(connection.fromNodeId);
            ids.add(connection.toNodeId);
        });
        return ids;
    }, [canvasViewBounds, nodeSpatialIndex, visibleConnections]);
    const visibleNodes = useMemo(
        () => nodes.filter((node) => visibleNodeIds.has(node.id) && !isHiddenBatchChild(node, nodeById, collapsingBatchIds)),
        [collapsingBatchIds, nodeById, nodes, visibleNodeIds],
    );
    // 工具条跟随「单选节点」:点击/新建/框选/键盘选中任一节点都会显示,不再仅靠精确点中触发。
    // 多选时不显示;拖拽中由下方 isNodeDragging 守卫隐藏。
    const singleSelectedNodeId = selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null;
    const toolbarNode = (toolbarNodeId ? nodeById.get(toolbarNodeId) || null : null) || (singleSelectedNodeId ? nodeById.get(singleSelectedNodeId) || null : null);
    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const maskEditNode = maskEditNodeId ? nodeById.get(maskEditNodeId) || null : null;
    const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
    const upscaleNode = upscaleNodeId ? nodeById.get(upscaleNodeId) || null : null;
    const superResolveNode = superResolveNodeId ? nodeById.get(superResolveNodeId) || null : null;
    const angleNode = angleNodeId ? nodeById.get(angleNodeId) || null : null;
    const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
    const hasMultipleSelectedNodes = selectedNodeIds.size > 1;
    const batchConnectionNodes = useMemo(
        () => nodes.filter((node) => selectedNodeIds.has(node.id) && node.type !== CanvasNodeType.Group && (getNodeDefinition(node.type)?.hasSourceHandle ?? true)),
        [nodes, selectedNodeIds],
    );
    const batchSelectionBounds = useMemo(() => (batchConnectionNodes.length > 1 ? nodeBounds(batchConnectionNodes) : null), [batchConnectionNodes]);
    const batchConnectionPreview = pendingConnectionCreate && pendingConnectionCreate.connections.length > 1 ? pendingConnectionCreate : null;
    const batchConnectingPreview = batchConnectingParams && !pendingConnectionCreate ? batchConnectingParams : null;
    const activeNodeId = hasMultipleSelectedNodes ? null : hoveredNodeId || (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null);
    const batchChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            if (node.metadata?.isBatchRoot) map.set(node.id, node.metadata.batchChildIds?.length || 0);
        });
        return map;
    }, [nodes]);
    const groupChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            const groupId = node.metadata?.groupId;
            if (groupId) map.set(groupId, (map.get(groupId) || 0) + 1);
        });
        return map;
    }, [nodes]);
    const batchMotionById = useMemo(() => {
        const map = new Map<string, { x: number; y: number; index: number }>();
        nodes.forEach((node) => {
            const rootId = node.metadata?.batchRootId;
            if (!rootId) return;
            const root = nodeById.get(rootId);
            const index = root?.metadata?.batchChildIds?.indexOf(node.id) ?? 0;
            const stackX = root ? root.position.x + 34 + index * 14 : node.position.x;
            const stackY = root ? root.position.y + 14 + index * 8 : node.position.y;
            map.set(node.id, { x: stackX - node.position.x, y: stackY - node.position.y, index: Math.max(index, 0) });
        });
        return map;
    }, [nodeById, nodes]);
    const relatedHighlight = useMemo(() => {
        const nodeIds = new Set<string>();
        const connectionIds = new Set<string>();

        if (!activeNodeId) return { nodeIds, connectionIds };

        nodeIds.add(activeNodeId);
        [...incomingConnections(graphIndex, activeNodeId), ...outgoingConnections(graphIndex, activeNodeId)].forEach((connection) => {
            connectionIds.add(connection.id);
            nodeIds.add(connection.fromNodeId);
            nodeIds.add(connection.toNodeId);
        });

        return { nodeIds, connectionIds };
    }, [activeNodeId, graphIndex]);

    const resourceContextNodeId = dialogNodeId || activeNodeId;
    const canvasResourceReferences = useMemo(() => buildCanvasResourceReferences(nodes, connections, resourceContextNodeId, graphIndex), [connections, graphIndex, nodes, resourceContextNodeId]);
    const resourceReferenceByNodeId = useMemo(() => new Map(canvasResourceReferences.map((reference) => [reference.nodeId, reference])), [canvasResourceReferences]);
    const mentionReferencesByNodeId = useMemo(() => {
        const map = new Map<string, ReturnType<typeof buildNodeMentionReferences>>();
        visibleNodes.forEach((node) => map.set(node.id, buildNodeMentionReferences(node, nodes, connections, graphIndex, node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video ? localAssets : [])));
        return map;
    }, [connections, graphIndex, localAssets, nodes, visibleNodes]);
    const agentSnapshot = useMemo<CanvasAgentSnapshot>(
        () => ({ projectId, title: currentProjectTitle || "未命名画布", nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport }),
        [connections, currentProjectTitle, nodes, projectId, selectedNodeIds, viewport],
    );
    const applyAgentOps = useCallback(
        (ops?: CanvasAgentOp[]) => {
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const before = { projectId, title: currentProjectTitle || "未命名画布", nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current };
            const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
            const next = applyCanvasAgentOps(
                before,
                safeOps.filter((op) => op.type !== "run_generation"),
            );
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            selectedNodeIdsRef.current = new Set(next.selectedNodeIds);
            viewportRef.current = next.viewport;
            setAgentUndoSnapshot(before);
            setNodes(next.nodes);
            setConnections(next.connections);
            setSelectedNodeIds(new Set(next.selectedNodeIds));
            setSelectedConnectionId(null);
            setViewport(next.viewport);
            setContextMenu(null);
            if (generationOps.length) {
                queueMicrotask(() =>
                    generationOps.forEach((op) => {
                        const target = nodesRef.current.find((node) => node.id === op.nodeId);
                        const prompt = op.prompt?.trim() ? op.prompt : (target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                        void generateNodeRef.current?.(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt);
                    }),
                );
            }
            return { ...next, projectId, title: currentProjectTitle || "未命名画布" };
        },
        [currentProjectTitle, projectId],
    );
    const undoAgentOps = useCallback(() => {
        if (!agentUndoSnapshot) return null;
        nodesRef.current = agentUndoSnapshot.nodes;
        connectionsRef.current = agentUndoSnapshot.connections;
        selectedNodeIdsRef.current = new Set(agentUndoSnapshot.selectedNodeIds);
        viewportRef.current = agentUndoSnapshot.viewport;
        setNodes(agentUndoSnapshot.nodes);
        setConnections(agentUndoSnapshot.connections);
        setSelectedNodeIds(new Set(agentUndoSnapshot.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(agentUndoSnapshot.viewport);
        setContextMenu(null);
        setAgentUndoSnapshot(null);
        return { ...agentUndoSnapshot, projectId, title: currentProjectTitle || "未命名画布" };
    }, [agentUndoSnapshot, currentProjectTitle, projectId]);

    useEffect(() => {
        if (!SHOW_AGENT_UI) {
            setAgentCanvasContext(null);
            return;
        }
        setAgentCanvasContext({ snapshot: agentSnapshot, applyOps: applyAgentOps, undoOps: undoAgentOps, canUndo: Boolean(agentUndoSnapshot) });
        return () => setAgentCanvasContext(null);
    }, [agentSnapshot, applyAgentOps, agentUndoSnapshot, setAgentCanvasContext, undoAgentOps]);

    // 提供给插件节点的宿主能力(节点无关,方法接收 nodeId)
    const pluginHost = useMemo<CanvasPluginHost>(
        () => ({
            getNode: (id) => nodesRef.current.find((node) => node.id === id) || null,
            getNodes: () => nodesRef.current,
            getConnections: () => connectionsRef.current,
            getUpstream: (nodeId) =>
                connectionsRef.current
                    .filter((conn) => conn.toNodeId === nodeId)
                    .map((conn) => nodesRef.current.find((node) => node.id === conn.fromNodeId))
                    .filter((node): node is CanvasNodeData => Boolean(node)),
            getDownstream: (nodeId) =>
                connectionsRef.current
                    .filter((conn) => conn.fromNodeId === nodeId)
                    .map((conn) => nodesRef.current.find((node) => node.id === conn.toNodeId))
                    .filter((node): node is CanvasNodeData => Boolean(node)),
            updateNode: (nodeId, patch) => setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, ...patch } : node))),
            updateMetadata: (nodeId, patch) => setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...patch } } : node))),
            applyOps: (ops) => applyAgentOps(ops),
        }),
        [applyAgentOps],
    );

    const renderPluginPanel = useCallback(
        (panelNode: CanvasNodeData) => {
            const Panel = getNodeDefinition(panelNode.type)?.Panel;
            if (!Panel) return null;
            const ctx = buildNodeContext(pluginHost, panelNode, theme, viewportRef.current.k);
            return <Panel ctx={ctx} onClose={() => setDialogNodeId(null)} />;
        },
        [pluginHost, theme],
    );

    // 启动时加载已安装的远程插件
    useEffect(() => {
        void ensurePluginsLoaded();
    }, []);
    const createNode = useCallback(
        (type: CanvasNodeTypeId, position?: Position) => {
            const targetPosition = position || getCanvasCenter();
            const configMetadata =
                type === CanvasNodeType.Audio
                      ? {
                            sourceType: "tts" as const,
                            model: effectiveConfig.audioModel,
                            audioVoice: effectiveConfig.audioVoice,
                            audioVoiceName: effectiveConfig.audioVoiceName,
                            audioFormat: effectiveConfig.audioFormat,
                            audioSpeed: effectiveConfig.audioSpeed,
                            audioInstructions: effectiveConfig.audioInstructions,
                        }
                      : undefined;
            const createdNode = createCanvasNode(type, targetPosition, configMetadata);
            const newNode = type === CanvasNodeType.Audio ? { ...createdNode, title: "配音" } : createdNode;

            setNodes((prev) => [...prev, newNode]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            const definition = getNodeDefinition(type);
            // 纯展示型插件节点(hidePanel)不弹面板;插件自定义 Panel 需显式 autoOpenPanel 才在新建时打开;
            // 内置的图片/视频/配置类节点保持原有「新建即打开生图面板」行为。
            const wantsPanel = definition?.hidePanel ? false : definition?.Panel ? Boolean(definition.autoOpenPanel) : isBuiltinType(type) && type !== CanvasNodeType.Text && type !== CanvasNodeType.Group;
            if (wantsPanel) setDialogNodeId(newNode.id);
            if (type === CanvasNodeType.AssetExtraction) {
                if (!userConnection) {
                    message.error("请先登录后再创建资产提取节点");
                    setNodes((prev) => prev.filter((node) => node.id !== newNode.id));
                    setSelectedNodeIds(new Set());
                    return;
                }
                void (async () => {
                    try {
                        let created;
                        try {
                            created = await canvasScriptApi.createSet(userConnection, { projectId, nodeId: newNode.id, title: newNode.title, visualStyle: newNode.metadata?.assetExtractionVisualStyle });
                        } catch (error) {
                            await syncProjectSnapshot({ nodes: [...nodesRef.current, newNode] });
                            created = await canvasScriptApi.createSet(userConnection, { projectId, nodeId: newNode.id, title: newNode.title, visualStyle: newNode.metadata?.assetExtractionVisualStyle });
                        }
                        const episode = type === CanvasNodeType.AssetExtraction ? created.episodes[0] || await canvasScriptApi.createEpisode(userConnection, created.id) : undefined;
                        setNodes((prev) => prev.map((node) => (node.id === newNode.id ? { ...node, title: created.title, metadata: { ...node.metadata, scriptSetId: created.id, scriptSetNodeId: newNode.id, ...(episode ? { assetExtractionEpisodeId: episode.id } : {}) } } : node)));
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : "资产提取节点初始化失败");
                        setNodes((prev) => prev.filter((node) => node.id !== newNode.id));
                        setSelectedNodeIds(new Set());
                    }
                })();
            }
        },
        [
            effectiveConfig.audioFormat,
            effectiveConfig.audioInstructions,
            effectiveConfig.audioModel,
            effectiveConfig.audioSpeed,
            effectiveConfig.audioVoice,
            effectiveConfig.audioVoiceName,
            effectiveConfig.canvasImageCount,
            effectiveConfig.count,
            effectiveConfig.imageModel,
            effectiveConfig.model,
            effectiveConfig.size,
            getCanvasCenter,
            message,
            projectId,
            syncProjectSnapshot,
            textSelections,
            userConnection,
        ],
    );

    const groupSelectedNodes = useCallback(() => {
        const selectedNodes = nodesRef.current.filter((node) => selectedNodeIdsRef.current.has(node.id) && node.type !== CanvasNodeType.Group);
        if (!selectedNodes.length) {
            createNode(CanvasNodeType.Group);
            return;
        }

        const bounds = nodeBounds(selectedNodes);
        const padding = 36;
        const group = createCanvasNode(CanvasNodeType.Group, {
            x: bounds.left + (bounds.right - bounds.left) / 2,
            y: bounds.top + (bounds.bottom - bounds.top) / 2,
        }, { groupColor: "#7c3aed" });
        const nextGroup = {
            ...group,
            position: { x: bounds.left - padding, y: bounds.top - padding },
            width: Math.max(group.width, bounds.right - bounds.left + padding * 2),
            height: Math.max(group.height, bounds.bottom - bounds.top + padding * 2),
        };
        const selectedIds = new Set(selectedNodes.map((node) => node.id));
        const nextNodes = [
            ...nodesRef.current.map((node) => selectedIds.has(node.id) ? { ...node, metadata: { ...node.metadata, groupId: nextGroup.id } } : node),
            nextGroup,
        ];
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
        setSelectedNodeIds(new Set([nextGroup.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(null);
    }, [createNode]);

    const handleGroupColorChange = useCallback((nodeId: string, color: string) => {
        setNodes((prev) => prev.map((node) => node.id === nodeId && node.type === CanvasNodeType.Group ? { ...node, metadata: { ...node.metadata, groupColor: color } } : node));
    }, []);

    const deleteNodes = useCallback(
        (ids: Set<string>) => {
            if (!ids.size) return;
            const scriptNodes = nodesRef.current.filter((node) => ids.has(node.id) && node.type === CanvasNodeType.AssetExtraction);
            const performDelete = () => {
            const allIds = new Set(ids);
            const scriptSetIds = new Set(scriptNodes.map((node) => node.metadata?.scriptSetId).filter(Boolean));
            nodesRef.current.forEach((node) => {
                if (ids.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => allIds.add(childId));
                if (node.metadata?.scriptSetId && scriptSetIds.has(node.metadata.scriptSetId)) allIds.add(node.id);
            });
            setNodes((prev) => {
                const next = prev.filter((node) => !allIds.has(node.id));
                return next.map((node) => {
                    const groupId = node.metadata?.groupId;
                    if (groupId && allIds.has(groupId)) return { ...node, metadata: { ...node.metadata, groupId: undefined } };
                    const childIds = node.metadata?.batchChildIds?.filter((childId) => !allIds.has(childId));
                    if (!node.metadata?.isBatchRoot || childIds?.length === node.metadata.batchChildIds?.length) return node;
                    const primaryImageId = childIds?.includes(node.metadata.primaryImageId || "") ? node.metadata.primaryImageId : childIds?.[0];
                    const primaryNode = next.find((item) => item.id === primaryImageId);
                    return primaryNode ? syncBatchPrimaryNode({ ...node, metadata: { ...node.metadata, batchChildIds: childIds } }, primaryNode) : { ...node, metadata: { ...node.metadata, batchChildIds: childIds, primaryImageId } };
                });
            });
            setConnections((prev) => prev.filter((conn) => !allIds.has(conn.fromNodeId) && !allIds.has(conn.toNodeId)));
            setSelectedNodeIds(new Set());
            setSelectedConnectionId(null);
            setHoveredNodeId((current) => (current && allIds.has(current) ? null : current));
            setToolbarNodeId((current) => (current && allIds.has(current) ? null : current));
            setDialogNodeId((current) => (current && allIds.has(current) ? null : current));
            setEditingNodeId((current) => (current && allIds.has(current) ? null : current));
            setInfoNodeId((current) => (current && allIds.has(current) ? null : current));
            setCropNodeId((current) => (current && allIds.has(current) ? null : current));
            setMaskEditNodeId((current) => (current && allIds.has(current) ? null : current));
            setAngleNodeId((current) => (current && allIds.has(current) ? null : current));
            setPreviewNodeId((current) => (current && allIds.has(current) ? null : current));
            setRunningNodeId((current) => (current && allIds.has(current) ? null : current));
            setContextMenu((current) => (current?.type === "node" && allIds.has(current.nodeId) ? null : current));
            cleanupCanvasFiles({ projectId, nodes: nodesRef.current.filter((node) => !allIds.has(node.id)), chatSessions });
            };
            if (!scriptNodes.length) {
                performDelete();
                return;
            }
            Modal.confirm({
                title: "删除资产数据？",
                content: "对应的正文、资产和分析结果将一并删除，关联的画布资产节点也会移除。",
                okText: "删除",
                okButtonProps: { danger: true },
                cancelText: "取消",
                onOk: async () => {
                    if (userConnection) {
                        await Promise.all([
                            ...scriptNodes.map((node) => (node.metadata?.scriptSetId ? canvasScriptApi.deleteSet(userConnection, node.metadata.scriptSetId) : Promise.resolve())),
                        ]);
                    }
                    performDelete();
                },
            });
        },
        [chatSessions, cleanupCanvasFiles, projectId, userConnection],
    );

    const deleteConnection = useCallback((connectionId: string) => {
        const connection = connectionsRef.current.find((conn) => conn.id === connectionId);
        if (connection) {
            const endpointIds = new Set([connection.fromNodeId, connection.toNodeId]);
            const nextNodes = nodesRef.current.map((node) => {
                if (!endpointIds.has(node.id) || node.metadata?.referenceOrder?.length) return node;
                const referenceOrder = mergeCanvasReferenceOrder(node.id, nodesRef.current, connectionsRef.current);
                return referenceOrder.length ? { ...node, metadata: { ...node.metadata, referenceOrder } } : node;
            });
            nodesRef.current = nextNodes;
            setNodes(nextNodes);
        }
        const nextConnections = connectionsRef.current.filter((conn) => conn.id !== connectionId);
        connectionsRef.current = nextConnections;
        setConnections(nextConnections);
        setSelectedConnectionId((current) => (current === connectionId ? null : current));
        setContextMenu((current) => (current?.type === "connection" && current.connectionId === connectionId ? null : current));
    }, []);

    const deselectCanvas = useCallback(() => {
        cancelPendingConnectionCreate();
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setSelectionBox(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setDialogNodeId(null);
        setEditingNodeId(null);
    }, [cancelPendingConnectionCreate]);

    const clearCanvas = useCallback(() => {
        if (userConnection) {
            const scriptSetIds = [...new Set(nodesRef.current.map((node) => node.metadata?.scriptSetId).filter((value): value is string => Boolean(value)))];
            void Promise.all(scriptSetIds.map((id) => canvasScriptApi.deleteSet(userConnection, id))).catch(() => undefined);
        }
        setNodes([]);
        setConnections([]);
        setInfoNodeId(null);
        setCropNodeId(null);
        setMaskEditNodeId(null);
        setAngleNodeId(null);
        setPreviewNodeId(null);
        setRunningNodeId(null);
        deselectCanvas();
        setClearConfirmOpen(false);
        cleanupCanvasFiles({ projectId, nodes: [], chatSessions: [] });
    }, [cleanupCanvasFiles, deselectCanvas, projectId, userConnection]);

    const duplicateNode = useCallback(
        (nodeId: string) => {
        const source = nodesRef.current.find((node) => node.id === nodeId);
        if (!source) return;
        const id = `${source.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const next: CanvasNodeData = {
            ...source,
            id,
            title: `${source.title} Copy`,
            position: { x: source.position.x + 36, y: source.position.y + 36 },
        };

        setNodes((prev) => [...prev, next]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        if (next.type !== CanvasNodeType.Group) setDialogNodeId(id);
        },
        [message],
    );

    const copySelectedNodes = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        if (!selectedIds.size) return;
        const copiedNodes = nodesRef.current
            .filter((node) => selectedIds.has(node.id))
            .map((node) => ({
                ...node,
                position: { ...node.position },
                metadata: node.metadata ? { ...node.metadata } : undefined,
            }));

        if (!copiedNodes.length) return;

        clipboardRef.current = {
            nodes: copiedNodes,
            connections: connectionsRef.current.filter((connection) => selectedIds.has(connection.fromNodeId) && selectedIds.has(connection.toNodeId)).map((connection) => ({ ...connection })),
        };
    }, [message]);

    const pasteCopiedNodes = useCallback(() => {
        const clipboard = clipboardRef.current;
        if (!clipboard?.nodes.length) return false;

        const center = getCanvasCenter();
        const bounds = clipboard.nodes.reduce(
            (acc, node) => ({
                left: Math.min(acc.left, node.position.x),
                top: Math.min(acc.top, node.position.y),
                right: Math.max(acc.right, node.position.x + node.width),
                bottom: Math.max(acc.bottom, node.position.y + node.height),
            }),
            { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
        );
        const dx = center.x - (bounds.left + bounds.right) / 2;
        const dy = center.y - (bounds.top + bounds.bottom) / 2;
        const idMap = new Map<string, string>();
        const nextNodes = clipboard.nodes.map((node, index) => {
            const id = `${node.type}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
            idMap.set(node.id, id);
            return {
                ...node,
                id,
                title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                position: {
                    x: node.position.x + dx,
                    y: node.position.y + dy,
                },
                metadata: node.metadata ? { ...node.metadata } : undefined,
            };
        });

        const pastedNodes = nextNodes.map((node) => {
            const groupId = node.metadata?.groupId;
            if (!groupId) return node;
            return { ...node, metadata: { ...node.metadata, groupId: idMap.get(groupId) } };
        });

        const nextConnections = clipboard.connections.flatMap((connection, index) => {
            const fromNodeId = idMap.get(connection.fromNodeId);
            const toNodeId = idMap.get(connection.toNodeId);
            if (!fromNodeId || !toNodeId) return [];
            return [
                {
                    ...connection,
                    id: `conn-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
                    fromNodeId,
                    toNodeId,
                },
            ];
        });

        setNodes((prev) => [...prev, ...pastedNodes]);
        setConnections((prev) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set(pastedNodes.map((node) => node.id)));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(pastedNodes[0]?.type === CanvasNodeType.Group ? null : pastedNodes[0]?.id || null);
        return true;
    }, [getCanvasCenter]);

    const resetViewport = useCallback(() => {
        setViewport({ x: size.width / 2, y: size.height / 2, k: 1 });
        setContextMenu(null);
    }, [size.height, size.width]);

    const focusNode = useCallback(
        (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (!node) return;
            const worldX = node.position.x + node.width / 2;
            const worldY = node.position.y + node.height / 2;
            const k = Math.min(Math.max(Math.min((size.width * 0.6) / node.width, (size.height * 0.6) / node.height), 0.05), 1.5);
            setViewport({ x: size.width / 2 - worldX * k, y: size.height / 2 - worldY * k, k });
            setSelectedNodeIds(new Set([nodeId]));
            setSelectedConnectionId(null);
            setContextMenu(null);
        },
        [size.height, size.width],
    );

    const setZoomScale = useCallback(
        (scale: number) => {
            const nextScale = Math.min(Math.max(scale, 0.05), 5);
            setViewport((prev) => ({
                x: size.width / 2 - ((size.width / 2 - prev.x) / prev.k) * nextScale,
                y: size.height / 2 - ((size.height / 2 - prev.y) / prev.k) * nextScale,
                k: nextScale,
            }));
            setContextMenu(null);
        },
        [size.height, size.width],
    );

    const applyHistory = useCallback((entry: CanvasHistoryEntry) => {
        if (historyCommitTimerRef.current) {
            clearTimeout(historyCommitTimerRef.current);
            historyCommitTimerRef.current = null;
        }
        applyingHistoryRef.current = true;
        setNodes(entry.nodes);
        setConnections(entry.connections);
        setChatSessions(entry.chatSessions);
        setActiveChatId(entry.activeChatId);
        setBackgroundMode(entry.backgroundMode);
        setShowImageInfo(entry.showImageInfo);
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setTimeout(() => {
            lastHistoryRef.current = entry;
            applyingHistoryRef.current = false;
            setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
        });
    }, []);

    const undoCanvas = useCallback(() => {
        const previous = historyRef.current.past.pop();
        const current = lastHistoryRef.current;
        if (!previous || !current) return;
        historyRef.current.future.push(current);
        applyHistory(previous);
    }, [applyHistory]);

    const redoCanvas = useCallback(() => {
        const next = historyRef.current.future.pop();
        const current = lastHistoryRef.current;
        if (!next || !current) return;
        historyRef.current.past.push(current);
        applyHistory(next);
    }, [applyHistory]);

    const createAndOpenProject = useCallback(() => {
        const id = createProject(`无限画布 ${useCanvasStore.getState().projects.length + 1}`);
        navigate(`/canvas/${id}`);
    }, [createProject, navigate]);

    const deleteCurrentProject = useCallback(() => {
        deleteProjects([projectId]);
        cleanupAssetImages();
        navigate("/canvas");
    }, [cleanupAssetImages, deleteProjects, navigate, projectId]);

    const handleCanvasMouseDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            setContextMenu(null);
            setNodeCreatePosition(null);
            if (pendingConnectionCreateRef.current) cancelPendingConnectionCreate();
            if (event.button !== 0) return;

            // 框选从空白处开始时,清理上一个节点留下的悬浮工具条和编辑面板。
            setHoveredNodeId(null);
            setToolbarNodeId(null);
            setDialogNodeId(null);

            const world = screenToCanvas(event.clientX, event.clientY);
            const nextSelectionBox = {
                startWorldX: world.x,
                startWorldY: world.y,
                currentWorldX: world.x,
                currentWorldY: world.y,
                additive: event.shiftKey,
                initialSelectedNodeIds: event.shiftKey ? Array.from(selectedNodeIdsRef.current) : [],
            };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            if (!event.shiftKey) {
                setSelectedNodeIds(new Set());
            }

            setSelectedConnectionId(null);
        },
        [cancelPendingConnectionCreate, screenToCanvas],
    );

    // 仅处理「选中」的纯逻辑,供 body 冒泡拖拽入口与外层 capture 入口共用。
    // 返回本次点击后的单选目标 id(多选/取消时为 null),用于同步工具条。
    const selectNodeByEvent = useCallback((event: Pick<ReactMouseEvent, "shiftKey" | "metaKey" | "ctrlKey">, nodeId: string) => {
        const nextSelected = new Set(selectedNodeIdsRef.current);
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            if (nextSelected.has(nodeId)) nextSelected.delete(nodeId);
            else nextSelected.add(nodeId);
        } else if (!nextSelected.has(nodeId)) {
            nextSelected.clear();
            nextSelected.add(nodeId);
        }
        setSelectedNodeIds(nextSelected);
        const soloId = nextSelected.size === 1 && nextSelected.has(nodeId) ? nodeId : null;
        setToolbarNodeId(soloId);
        return { nextSelected, soloId };
    }, []);

    // capture 阶段选中:点击节点内部任意元素(含吞掉 mousedown 的 textarea/iframe)都能选中并弹出工具条。
    // 只做选中,不启动拖拽 —— 拖拽仍由 body 的 onMouseDown(冒泡)负责,故编辑器内选词不会拖动节点。
    // capture 必先于同一次事件的 body 冒泡触发,故把算好的选中集暂存,供紧随其后的拖拽入口复用,避免二次选中(shift 反选被抵消)。
    const pendingSelectionRef = useRef<Set<string> | null>(null);
    const handleNodeSelectCapture = useCallback(
        (event: ReactMouseEvent, nodeId: string) => {
        if (event.button !== 0) return;
        setContextMenu(null);
        setHoveredNodeId(null);
        setSelectedConnectionId(null);
        const { nextSelected } = selectNodeByEvent(event, nodeId);
        pendingSelectionRef.current = nextSelected;
        },
        [selectNodeByEvent],
    );

    const handleNodeMouseDown = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.stopPropagation();
        // 选中已由 capture 阶段完成;这里只负责建立拖拽。若因故没走 capture,则兜底再选一次。
        const currentNodes = nodesRef.current;
        const nextSelected = pendingSelectionRef.current ?? selectNodeByEvent(event, nodeId).nextSelected;
        pendingSelectionRef.current = null;
        const dragIds = new Set(nextSelected);
        currentNodes.forEach((node) => {
            if (!nextSelected.has(node.id)) return;
            node.metadata?.batchChildIds?.forEach((childId) => dragIds.add(childId));
            if (node.type === CanvasNodeType.Group) {
                currentNodes.forEach((child) => {
                    if (child.metadata?.groupId === node.id) dragIds.add(child.id);
                });
            }
        });
        const initialSelectedNodes = currentNodes.filter((node) => dragIds.has(node.id)).map((node) => ({ id: node.id, x: node.position.x, y: node.position.y }));
        const nodeElements = new Map(
            Array.from(containerRef.current?.querySelectorAll<HTMLElement>("[data-node-id]") || [])
                .filter((element) => element.dataset.nodeId && dragIds.has(element.dataset.nodeId))
                .map((element) => [element.dataset.nodeId!, element]),
        );
        const connectionPathById = new Map(
            Array.from(containerRef.current?.querySelectorAll<SVGPathElement>("[data-connection-id]") || []).map((path) => [path.dataset.connectionId!, Array.from(path.parentElement?.querySelectorAll<SVGPathElement>("path") || [])]),
        );
        dragRef.current = {
            isDraggingNode: true,
            hasMoved: false,
            startX: event.clientX,
            startY: event.clientY,
            previewDx: 0,
            previewDy: 0,
            initialSelectedNodes,
            initialById: new Map(initialSelectedNodes.map((item) => [item.id, item])),
            movedIds: dragIds,
            nodeById: new Map(currentNodes.map((node) => [node.id, node])),
            nodeElements,
            connectionElements: connectionsRef.current
                .filter((connection) => dragIds.has(connection.fromNodeId) || dragIds.has(connection.toNodeId))
                .map((connection) => ({ connection, paths: connectionPathById.get(connection.id) || [] })),
        };
        historyPausedRef.current = true;
        nodeDraggingRef.current = true;
        setIsNodeDragging(true);
    }, []);

    const finishNodeDrag = useCallback((clientX?: number, clientY?: number) => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (!dragRef.current.isDraggingNode) return;

        const wasClick = !dragRef.current.hasMoved && dragRef.current.initialSelectedNodes.length === 1;
        const clickedNodeId = dragRef.current.initialSelectedNodes[0]?.id;
        const currentViewport = viewportRef.current;
        const dx = clientX == null ? 0 : (clientX - dragRef.current.startX) / currentViewport.k;
        const dy = clientY == null ? 0 : (clientY - dragRef.current.startY) / currentViewport.k;
        const initialPositions = dragRef.current.initialSelectedNodes;

        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        setIsNodeDragging(false);
        setDropTargetGroupId(null);
        if (dragRef.current.hasMoved && clientX != null && clientY != null) {
            const movedIds = new Set(initialPositions.map((item) => item.id));
            setNodes((prev) => {
                const moved = prev.map((node) => {
                    const initial = initialPositions.find((item) => item.id === node.id);
                    return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                });
                const targetGroup = findGroupDropTarget(movedIds, moved);
                if (targetGroup) return snapNodesIntoGroup(movedIds, moved, targetGroup);
                return moved.map((node) => {
                    if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group) return node;
                    const groupId = findContainingGroupId(node, moved);
                    if (node.metadata?.groupId === groupId) return node;
                    return { ...node, metadata: { ...node.metadata, groupId } };
                });
            });
        } else if (dragRef.current.hasMoved) {
            applyNodeDragPreview(dragRef.current, 0, 0);
        }

        dragRef.current.isDraggingNode = false;
        dragRef.current.hasMoved = false;
        dragRef.current.initialSelectedNodes = [];
        dragRef.current.initialById.clear();
        dragRef.current.movedIds.clear();
        dragRef.current.nodeById.clear();
        dragRef.current.nodeElements.clear();
        dragRef.current.connectionElements = [];
        if (wasClick && clickedNodeId) {
            const clickedNode = nodesRef.current.find((node) => node.id === clickedNodeId);
            const clickedDefinition = clickedNode ? getNodeDefinition(clickedNode.type) : undefined;
            if (clickedNode?.type === CanvasNodeType.Text) {
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else if (clickedDefinition?.hidePanel) {
                // 纯展示型插件节点:单击只选中,不弹下方面板
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else if (clickedNode?.type !== CanvasNodeType.Group) {
                setDialogNodeId(clickedNodeId);
            }
        }
    }, []);

    const handleGlobalMouseMove = useCallback(
        (event: MouseEvent) => {
            const currentViewport = viewportRef.current;

            if (dragRef.current.isDraggingNode) {
                const dx = (event.clientX - dragRef.current.startX) / currentViewport.k;
                const dy = (event.clientY - dragRef.current.startY) / currentViewport.k;
                if (Math.abs(event.clientX - dragRef.current.startX) > 3 || Math.abs(event.clientY - dragRef.current.startY) > 3) {
                    dragRef.current.hasMoved = true;
                }
                if (!dragRef.current.hasMoved) return;
                dragRef.current.previewDx = dx;
                dragRef.current.previewDy = dy;

                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                rafRef.current = requestAnimationFrame(() => {
                    const currentDrag = dragRef.current;
                    applyNodeDragPreview(currentDrag, currentDrag.previewDx, currentDrag.previewDy);
                    const nextDropTargetId = findGroupDropTargetDuringDrag(currentDrag, nodesRef.current)?.id || null;
                    setDropTargetGroupId((current) => (current === nextDropTargetId ? current : nextDropTargetId));
                    rafRef.current = null;
                });
                return;
            }

            const batchConnection = batchConnectingRef.current;
            if (batchConnection && Math.hypot(event.clientX - batchPointerStartRef.current.x, event.clientY - batchPointerStartRef.current.y) > 3) {
                batchDidMoveRef.current = true;
            }
            const currentConnection = connectingParamsRef.current || batchConnection?.[0];
            if (currentConnection && !pendingConnectionCreateRef.current) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, currentConnection);
                connectionTargetNodeIdRef.current = dropTarget.nodeId;
                setConnectionTargetNodeId(dropTarget.nodeId);
                setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            }
        },
        [finishNodeDrag, getConnectionDropTarget, screenToCanvas],
    );

    const handleGlobalPointerMove = useCallback(
        (event: PointerEvent) => {
            const currentSelection = selectionBoxRef.current;
            if (!currentSelection) {
                const batchConnection = batchConnectingRef.current;
                if (batchConnection && Math.hypot(event.clientX - batchPointerStartRef.current.x, event.clientY - batchPointerStartRef.current.y) > 3) {
                    batchDidMoveRef.current = true;
                }
                const currentConnection = connectingParamsRef.current || batchConnection?.[0];
                if (currentConnection && !pendingConnectionCreateRef.current) {
                    const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, currentConnection);
                    connectionTargetNodeIdRef.current = dropTarget.nodeId;
                    setConnectionTargetNodeId(dropTarget.nodeId);
                    setMouseWorld(screenToCanvas(event.clientX, event.clientY));
                }
                return;
            }

            if (event.buttons === 0) {
                selectionBoxRef.current = null;
                setSelectionBox(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const rectX = Math.min(currentSelection.startWorldX, world.x);
            const rectY = Math.min(currentSelection.startWorldY, world.y);
            const rectW = Math.abs(world.x - currentSelection.startWorldX);
            const rectH = Math.abs(world.y - currentSelection.startWorldY);
            const nextSelected = new Set<string>(currentSelection.additive ? currentSelection.initialSelectedNodeIds : []);

            nodesRef.current
                .filter((node) => !isHiddenBatchChild(node, nodesRef.current))
                .forEach((node) => {
                    const intersects = rectX < node.position.x + node.width && rectX + rectW > node.position.x && rectY < node.position.y + node.height && rectY + rectH > node.position.y;

                    if (intersects) nextSelected.add(node.id);
                });

            const nextSelectionBox = { ...currentSelection, currentWorldX: world.x, currentWorldY: world.y };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            setSelectedNodeIds(nextSelected);
        },
        [getConnectionDropTarget, screenToCanvas],
    );

    const handleGlobalMouseUp = useCallback(
        (event: MouseEvent) => {
            finishNodeDrag(event.clientX, event.clientY);

            selectionBoxRef.current = null;
            setSelectionBox(null);

            if (pendingConnectionCreateRef.current) return;

            const batchConnections = batchConnectingRef.current;
            if (batchConnections) {
                batchConnectingRef.current = null;
                setBatchConnectingParams(null);
                if (!batchDidMoveRef.current) return;
                suppressBatchConnectClickRef.current = true;
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, batchConnections[0]);
                if (dropTarget.nodeId) {
                    connectMultipleNodes(batchConnections, dropTarget.nodeId);
                    setConnectionTargetNodeId(null);
                } else if (dropTarget.isNearNode) {
                    setConnectionTargetNodeId(null);
                } else {
                    const position = screenToCanvas(event.clientX, event.clientY);
                    setMouseWorld(position);
                    setPendingConnectionCreate({ connections: batchConnections, position, anchorPosition: position });
                }
                return;
            }

            const currentConnection = connectingParamsRef.current;
            if (currentConnection) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, currentConnection);
                if (dropTarget.nodeId) {
                    connectNodes(currentConnection, dropTarget.nodeId);
                    setConnecting(null);
                } else if (dropTarget.isNearNode) {
                    setConnecting(null);
                } else {
                    setMouseWorld(screenToCanvas(event.clientX, event.clientY));
                    setPendingConnectionCreate({ connections: [currentConnection], position: screenToCanvas(event.clientX, event.clientY) });
                }
            }
        },
        [connectMultipleNodes, connectNodes, finishNodeDrag, getConnectionDropTarget, screenToCanvas, setConnecting],
    );

    useEffect(() => {
        const cancelNodeDrag = () => {
            finishNodeDrag();
            if (!batchConnectingRef.current) return;
            batchConnectingRef.current = null;
            batchDidMoveRef.current = false;
            setBatchConnectingParams(null);
            setConnectionTargetNodeId(null);
        };
        window.addEventListener("mousemove", handleGlobalMouseMove);
        window.addEventListener("mouseup", handleGlobalMouseUp);
        window.addEventListener("pointerup", handleGlobalMouseUp);
        window.addEventListener("pointercancel", cancelNodeDrag);
        window.addEventListener("blur", cancelNodeDrag);
        window.addEventListener("pointermove", handleGlobalPointerMove);
        return () => {
            window.removeEventListener("mousemove", handleGlobalMouseMove);
            window.removeEventListener("mouseup", handleGlobalMouseUp);
            window.removeEventListener("pointerup", handleGlobalMouseUp);
            window.removeEventListener("pointercancel", cancelNodeDrag);
            window.removeEventListener("blur", cancelNodeDrag);
            window.removeEventListener("pointermove", handleGlobalPointerMove);
        };
    }, [finishNodeDrag, handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalPointerMove]);

    const createImageFileNode = useCallback(async (file: File, position: Position) => {
        const image = await uploadImage(file);
        const size = fitNodeSize(image.width, image.height);
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newNode: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: file.name,
            position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
            width: size.width,
            height: size.height,
            metadata: imageMetadata(image),
        };

        setNodes((prev) => [...prev, newNode]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createVideoFileNode = useCallback(async (file: File, position: Position) => {
        const video = await uploadMediaFile(file, "video");
        const size = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
        const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Video,
                title: file.name,
                position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: videoMetadata(video),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createAudioFileNode = useCallback(async (file: File, position: Position) => {
        const audio = await uploadMediaFile(file, "audio");
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
        const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Audio,
                title: file.name,
                position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 },
                width: spec.width,
                height: spec.height,
                metadata: audioMetadata(audio, "upload"),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
    }, []);

    const createTextNodeFromClipboard = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (!trimmed) return false;

            const node = {
                ...createCanvasNode(CanvasNodeType.Text, getCanvasCenter(), { content: trimmed, status: NODE_STATUS_SUCCESS }),
                title: trimmed.slice(0, 32) || "剪切板文本",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
            setContextMenu(null);
            setDialogNodeId(node.id);
            return true;
        },
        [getCanvasCenter],
    );

    const pasteSystemClipboard = useCallback(async () => {
        if (!navigator.clipboard) return;

        const items = await navigator.clipboard.read();
        const imageItem = items.find((item) => item.types.some((type) => type.startsWith("image/")));
        if (imageItem) {
            const imageType = imageItem.types.find((type) => type.startsWith("image/"));
            if (!imageType) return;
            const blob = await imageItem.getType(imageType);
            const file = new File([blob], "clipboard-image.png", { type: imageType });
            void createImageFileNode(file, getCanvasCenter());
            message.success("已从剪切板添加图片");
            return;
        }

        const text = await navigator.clipboard.readText();
        if (createTextNodeFromClipboard(text)) message.success("已从剪切板添加文本");
    }, [createImageFileNode, createTextNodeFromClipboard, getCanvasCenter, message]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true'],[data-canvas-no-zoom]")) return;

            const key = event.key.toLowerCase();
            const isModifierShortcut = event.metaKey || event.ctrlKey;

            if (isModifierShortcut && !event.altKey && key === "z") {
                event.preventDefault();
                if (event.shiftKey) redoCanvas();
                else undoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "y") {
                event.preventDefault();
                redoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "a") {
                event.preventDefault();
                setSelectedNodeIds(new Set(nodesRef.current.map((node) => node.id)));
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "g") {
                event.preventDefault();
                groupSelectedNodes();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "c") {
                event.preventDefault();
                copySelectedNodes();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "v") {
                event.preventDefault();
                if (!pasteCopiedNodes()) void pasteSystemClipboard();
                return;
            }

            if (event.key === "Delete" || event.key === "Backspace") {
                if (selectedNodeIdsRef.current.size) {
                    deleteNodes(new Set(selectedNodeIdsRef.current));
                } else if (selectedConnectionId) {
                    deleteConnection(selectedConnectionId);
                }
            }

            if (event.key === "Escape") {
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                setContextMenu(null);
                setNodeCreatePosition(null);
                setSelectionBox(null);
                setConnecting(null);
                setHoveredNodeId(null);
                setToolbarNodeId(null);
                setDialogNodeId(null);
                setEditingNodeId(null);
                setInfoNodeId(null);
                setCropNodeId(null);
                setMaskEditNodeId(null);
                setPendingConnectionCreate(null);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [copySelectedNodes, deleteConnection, deleteNodes, groupSelectedNodes, pasteCopiedNodes, pasteSystemClipboard, redoCanvas, selectedConnectionId, setConnecting, undoCanvas]);

    const handleConnectStart = useCallback(
        (event: ReactMouseEvent, nodeId: string, handleType: "source" | "target") => {
            event.stopPropagation();
            setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            setConnecting({ nodeId, handleType });
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
            setSelectedConnectionId(null);
        },
        [screenToCanvas, setConnecting],
    );

    const handleNodeResize = useCallback((nodeId: string, width: number, height: number, position?: Position) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, width, height, position: position || node.position } : node)));
    }, []);

    const toggleNodeFreeResize = useCallback((nodeId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const freeResize = !node.metadata?.freeResize;
                if (freeResize || node.type !== CanvasNodeType.Image) return { ...node, metadata: { ...node.metadata, freeResize } };
                const ratio = (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1);
                const height = node.width / ratio;
                return { ...node, height, position: { x: node.position.x, y: node.position.y + node.height / 2 - height / 2 }, metadata: { ...node.metadata, freeResize } };
            }),
        );
    }, []);

    const handleNodeContentChange = useCallback((nodeId: string, content: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, content } } : node)));
    }, []);

    const handleTextSelectionChange = useCallback((nodeId: string, selectedText: string) => {
        setTextSelections((current) => (current[nodeId] === selectedText ? current : { ...current, [nodeId]: selectedText }));
    }, []);

    const handleNodeTitleChange = useCallback((nodeId: string, title: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, title } : node)));
    }, []);

    const toggleBatchExpanded = useCallback((nodeId: string) => {
        const isExpanded = Boolean(nodesRef.current.find((node) => node.id === nodeId)?.metadata?.imageBatchExpanded);
        if (isExpanded) {
            setCollapsingBatchIds((prev) => new Set(prev).add(nodeId));
            window.setTimeout(() => {
                setCollapsingBatchIds((prev) => {
                    const next = new Set(prev);
                    next.delete(nodeId);
                    return next;
                });
            }, 320);
        } else {
            setOpeningBatchIds((prev) => new Set(prev).add(nodeId));
            window.setTimeout(() => {
                setOpeningBatchIds((prev) => {
                    const next = new Set(prev);
                    next.delete(nodeId);
                    return next;
                });
            }, 260);
        }
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                return { ...node, metadata: { ...node.metadata, imageBatchExpanded: !node.metadata?.imageBatchExpanded } };
            }),
        );
    }, []);

    const setBatchPrimary = useCallback((child: CanvasNodeData) => {
        const rootId = child.metadata?.batchRootId;
        if (!rootId || !child.metadata?.content) return;
        setNodes((prev) =>
            prev.map((node) =>
                node.id === rootId
                    ? syncBatchPrimaryNode(node, child)
                    : node,
            ),
        );
    }, []);

    const openTextEditor = useCallback((node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Text) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(node.id);
        setEditingNodeId(node.id);
        setEditRequestNonce((value) => value + 1);
    }, []);

    const handleNodePromptChange = useCallback((nodeId: string, prompt: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt, referenceOrder: mergeCanvasReferenceOrder(nodeId, prev, connectionsRef.current) } } : node)));
    }, []);

    const handleConfigNodeChange = useCallback((nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyNodeConfigPatch(node, patch) : node)));
    }, []);

    const downloadNodeImage = useCallback(async (node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio) return;
        const metadata = node.metadata;
        const content = metadata?.content;
        if (!content) return message.error("没有可下载的媒体");

        try {
            const storedBlob = metadata.storageKey
                ? node.type === CanvasNodeType.Image
                    ? await getImageBlob(metadata.storageKey)
                    : await getMediaBlob(metadata.storageKey)
                : null;
            let blob = storedBlob;
            if (!blob) {
                const response = await fetch(content);
                if (!response.ok) throw new Error(`媒体请求失败（${response.status}）`);
                blob = await response.blob();
            }
            const extension = node.type === CanvasNodeType.Video ? "mp4" : node.type === CanvasNodeType.Audio ? audioExtension(metadata.mimeType || blob.type) : imageExtension(metadata.mimeType || blob.type || content);
            saveAs(blob, `canvas-${node.type}-${node.id}.${extension}`);
        } catch (error) {
            message.error(error instanceof Error ? `下载失败：${error.message}` : "下载失败，请重试");
        }
    }, [message]);

    const saveNodeAsset = useCallback(
        async (node: CanvasNodeData) => {
            if (node.type === CanvasNodeType.Text) {
                const content = node.metadata?.content?.trim();
                if (!content) return message.error("没有可保存的文本");
                addAsset({ kind: "text", title: node.metadata?.prompt?.slice(0, 24) || "画布文本", coverUrl: "", tags: [], source: "Canvas", data: { content }, metadata: { source: "canvas", nodeId: node.id } });
                message.success("已加入我的资产");
                return;
            }
            if (node.type === CanvasNodeType.Video) {
                if (!node.metadata?.content) return message.error("没有可保存的视频");
                addAsset({
                    kind: "video",
                    title: node.metadata?.prompt?.slice(0, 24) || "画布视频",
                    coverUrl: "",
                    tags: [],
                    source: "Canvas",
                    data: { url: node.metadata.content, storageKey: node.metadata.storageKey, width: node.width, height: node.height, bytes: node.metadata.bytes || 0, mimeType: node.metadata.mimeType || "video/mp4" },
                    metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
                });
                message.success("已加入我的资产");
                return;
            }
            if (!node.metadata?.content) return message.error("没有可保存的图片");
            const dataUrl = await resolveImageUrl(node.metadata.storageKey, node.metadata.content);
            addAsset({
                kind: "image",
                title: node.metadata?.prompt?.slice(0, 24) || "画布图片",
                coverUrl: dataUrl,
                tags: [],
                source: "Canvas",
                data: {
                    dataUrl,
                    storageKey: node.metadata.storageKey,
                    width: node.metadata.naturalWidth || node.width,
                    height: node.metadata.naturalHeight || node.height,
                    bytes: node.metadata.bytes || getDataUrlByteSize(dataUrl),
                    mimeType: node.metadata.mimeType || "image/png",
                },
                metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
            });
            message.success("已加入我的资产");
        },
        [addAsset, message],
    );

    useEffect(() => {
        if (!editingNodeId) return;
        const handleShortcut = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
            event.preventDefault();
            const node = nodesRef.current.find((item) => item.id === editingNodeId);
            if (node) void saveNodeAsset(node);
        };
        document.addEventListener("keydown", handleShortcut);
        return () => document.removeEventListener("keydown", handleShortcut);
    }, [editingNodeId, saveNodeAsset]);

    const createImageReversePromptNodes = useCallback(
        (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
                message.warning("图片节点为空，无法反推提示词");
                return;
            }

            const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
            const gap = 96;
            const centerY = node.position.y + node.height / 2;
            const textNode = {
                ...createCanvasNode(CanvasNodeType.Text, { x: node.position.x + node.width + gap + textSpec.width / 2, y: centerY }, { content: IMAGE_PROMPT_REVERSE_PRESET, prompt: IMAGE_PROMPT_REVERSE_PRESET, status: NODE_STATUS_SUCCESS, fontSize: 14 }),
                title: "反推提示词",
            };
            const targetNode = {
                ...createCanvasNode(CanvasNodeType.Text, { x: textNode.position.x + textNode.width + 96 + textSpec.width / 2, y: centerY }, { prompt: IMAGE_PROMPT_REVERSE_PRESET, model: effectiveConfig.textModel || effectiveConfig.model || defaultConfig.textModel }),
                title: "反推提示词结果",
            };

            setNodes((prev) => [...prev, textNode, targetNode]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: targetNode.id }, { id: nanoid(), fromNodeId: textNode.id, toNodeId: targetNode.id }]);
            setSelectedNodeIds(new Set([targetNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(targetNode.id);
            setContextMenu(null);
        },
        [effectiveConfig.model, effectiveConfig.textModel, message],
    );

    const cropImageNode = useCallback(async (node: CanvasNodeData, crop: CanvasImageCropRect) => {
        if (!node.metadata?.content) return;
        const cropped = await cropDataUrl(node.metadata.content, crop);
        const image = await uploadImage(cropped);
        const width = Math.min(node.width, Math.max(220, image.width));
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Cropped Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width,
            height: width * (image.height / image.width),
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
        setCropNodeId(null);
    }, []);

    const splitImageNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageSplitParams) => {
            if (!node.metadata?.content) return;
            setSplitNodeId(null);
            const pieces = await splitDataUrl(node.metadata.content, params);
            const gap = 16;
            const cellWidth = node.width / params.columns;
            const cellHeight = node.height / params.rows;
            const startX = node.position.x + node.width + 96;
            const startY = node.position.y;
            const childNodes = await Promise.all(
                pieces.map(async (piece) => {
                    const image = await uploadImage(piece.dataUrl);
                    const id = nanoid();
                    return {
                        id,
                        type: CanvasNodeType.Image,
                        title: `${node.title || "图片"} ${piece.row + 1}-${piece.column + 1}`,
                        position: { x: startX + piece.column * (cellWidth + gap), y: startY + piece.row * (cellHeight + gap) },
                        width: cellWidth,
                        height: cellHeight,
                        metadata: {
                            ...imageMetadata(image),
                            prompt: node.metadata?.prompt,
                        },
                    } satisfies CanvasNodeData;
                }),
            );
            setNodes((prev) => [...prev, ...childNodes]);
            setConnections((prev) => [...prev, ...childNodes.map((child) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: child.id }))]);
            setSelectedNodeIds(new Set(childNodes.map((child) => child.id)));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            message.success(`已切分为 ${childNodes.length} 个子节点`);
        },
        [message],
    );

    const maskEditImageNode = useCallback(
        async (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1", size: node.metadata?.size || "auto" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const userPrompt = payload.prompt.trim();
            unlockGenerationCompleteSound();
            const prompt = `只修改蒙版透明区域，其他区域保持不变。${userPrompt}`;
            const childId = nanoid();
            const source = { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey };
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [source]);
            setMaskEditNodeId(null);
            setRunningNodeId(childId);
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: userPrompt.slice(0, 32) || "局部编辑结果",
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: node.width,
                    height: node.height,
                    metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(generationConfig, prompt, [source], { id: `${node.id}-mask`, name: "mask.png", type: "image/png", dataUrl: payload.maskDataUrl }, { signal: controller.signal }).then((items) => items[0]);
                const uploaded = await uploadImage(image.dataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, node.width, node.height);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
                playGenerationCompleteSound();
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "局部修改失败";
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
    );

    const upscaleImageNode = useCallback(async (node: CanvasNodeData, params: CanvasImageUpscaleParams) => {
        if (!node.metadata?.content) return;
        setUpscaleNodeId(null);
        try {
            // Prefer the account-scoped IndexedDB Blob. A remote OSS URL can be
            // displayed by <img> but still taint a canvas when exported.
            const sourceDataUrl = await imageToDataUrl({ storageKey: node.metadata.storageKey, dataUrl: node.metadata.content });
            if (!sourceDataUrl) throw new Error("图片内容为空，无法放大");
            const upscaled = await upscaleDataUrl(sourceDataUrl, params);
            const image = await uploadImage(upscaled);
            const size = fitNodeSize(image.width, image.height);
            const childId = nanoid();
            const child: CanvasNodeData = {
                id: childId,
                type: CanvasNodeType.Image,
                title: "Upscaled Image",
                position: { x: node.position.x + node.width + 96, y: node.position.y },
                width: size.width,
                height: size.height,
                metadata: {
                    ...imageMetadata(image),
                    prompt: node.metadata?.prompt,
                },
            };
            setNodes((prev) => [...prev, child]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setDialogNodeId(childId);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "图片放大失败，请重试");
        }
    }, [message]);

    const generateAngleNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageAngleParams) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const childId = nanoid();
            unlockGenerationCompleteSound();
            const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const title = buildAngleLabel(params);
            const prompt = buildAnglePrompt(params);
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [
                { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey },
            ]);
            setAngleNodeId(null);
            setRunningNodeId(childId);
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title,
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: imageConfig.width,
                    height: imageConfig.height,
                    metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(
                    generationConfig,
                    prompt,
                    [{ id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey }],
                    undefined,
                    { signal: controller.signal },
                ).then((items) => items[0]);
                const uploaded = await uploadImage(image.dataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
                playGenerationCompleteSound();
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, openConfigDialog, startGenerationRequest],
    );

    const handleFontSizeChange = useCallback((nodeId: string, fontSize: number) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, fontSize } } : node)));
    }, []);

    const handleUploadRequest = useCallback((nodeId?: string, position?: Position) => {
        if (SUCAI_INTEGRATION && !userConnection) {
            requestCanvasLogin();
            return;
        }
        uploadTargetRef.current = { nodeId, position };
        imageInputRef.current?.click();
    }, [userConnection]);

    const handleImageInputChange = useCallback(
        async (event: ReactChangeEvent<HTMLInputElement>) => {
            const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/") || isAudioFile(file));
            const target = uploadTargetRef.current;
            if (!files.length) return;
            const file = files[0];

            if (target?.nodeId) {
                if (isAudioFile(file)) {
                    const audio = await uploadMediaFile(file, "audio");
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Audio,
                                      title: file.name,
                                      position: { x: node.position.x + node.width / 2 - spec.width / 2, y: node.position.y + node.height / 2 - spec.height / 2 },
                                      width: spec.width,
                                      height: spec.height,
                                      metadata: { ...node.metadata, ...audioMetadata(audio, "upload"), errorDetails: undefined },
                                  }
                                : node,
                        ),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                    uploadTargetRef.current = null;
                    event.target.value = "";
                    return;
                }
                if (file.type.startsWith("video/")) {
                    const video = await uploadMediaFile(file, "video");
                    const nextSize = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Video,
                                      title: file.name,
                                      position: { x: node.position.x + node.width / 2 - nextSize.width / 2, y: node.position.y + node.height / 2 - nextSize.height / 2 },
                                      width: nextSize.width,
                                      height: nextSize.height,
                                      metadata: { ...node.metadata, ...videoMetadata(video), errorDetails: undefined },
                                  }
                                : node,
                        ),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(target.nodeId);
                    uploadTargetRef.current = null;
                    event.target.value = "";
                    return;
                }
                const image = await uploadImage(file);
                const size = fitNodeSize(image.width, image.height);
                setNodes((prev) =>
                    prev.map((node) =>
                        node.id === target.nodeId
                            ? {
                                  ...node,
                                  type: CanvasNodeType.Image,
                                  title: file.name,
                                  width: size.width,
                                  height: size.height,
                                  metadata: {
                                      ...node.metadata,
                                      ...imageMetadata(image),
                                      errorDetails: undefined,
                                      freeResize: false,
                                      isBatchRoot: undefined,
                                      batchRootId: undefined,
                                      batchChildIds: undefined,
                                      batchUsesReferenceImages: undefined,
                                      generationType: undefined,
                                      model: undefined,
                                      size: undefined,
                                      quality: undefined,
                                      count: undefined,
                                      references: undefined,
                                      primaryImageId: undefined,
                                      imageBatchExpanded: undefined,
                                  },
                              }
                            : node,
                    ),
                );
                setSelectedNodeIds(new Set([target.nodeId]));
                setSelectedConnectionId(null);
                setDialogNodeId(target.nodeId);
            } else {
                const center = target?.position || getCanvasCenter();
                const columns = Math.max(1, Math.ceil(Math.sqrt(files.length)));
                const spacing = 48;
                await Promise.all(files.map((item, index) => {
                    const column = index % columns;
                    const row = Math.floor(index / columns);
                    const position = { x: center.x + (column - (columns - 1) / 2) * (NODE_DEFAULT_SIZE[CanvasNodeType.Image].width + spacing), y: center.y + (row - (Math.ceil(files.length / columns) - 1) / 2) * (NODE_DEFAULT_SIZE[CanvasNodeType.Image].height + spacing) };
                    return isAudioFile(item) ? createAudioFileNode(item, position) : item.type.startsWith("video/") ? createVideoFileNode(item, position) : createImageFileNode(item, position);
                }));
            }

            uploadTargetRef.current = null;
            event.target.value = "";
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, getCanvasCenter],
    );

    const handleDrop = useCallback(
        (event: ReactDragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/") || item.type.startsWith("video/") || isAudioFile(item));
            if (!file) return;

            const pos = screenToCanvas(event.clientX, event.clientY);
            void (isAudioFile(file) ? createAudioFileNode(file, pos) : file.type.startsWith("video/") ? createVideoFileNode(file, pos) : createImageFileNode(file, pos));
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas],
    );

    const startTitleEditing = useCallback(() => {
        setTitleDraft(currentProjectTitle || "未命名画布");
        setTitleEditing(true);
    }, [currentProjectTitle]);

    const finishTitleEditing = useCallback(() => {
        const nextTitle = titleDraft.trim();
        if (nextTitle) renameProject(projectId, nextTitle);
        setTitleEditing(false);
    }, [projectId, renameProject, titleDraft]);

    const preventCanvasContextMenu = useCallback((event: ReactMouseEvent) => {
        if ((event.target as HTMLElement).closest("[data-node-id]")) return;
        event.preventDefault();
        setContextMenu(null);
    }, []);

    const handleGenerateNode = useCallback(
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options?: CanvasNodeGenerationOptions) => {
            if (SUCAI_INTEGRATION && !userConnection) {
                requestCanvasLogin();
                return;
            }
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            const isVoiceDesign = mode === "audio" && (options?.audioMode === "design" || sourceNode?.metadata?.audioMode === "design");
            const generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);
            if (!isVoiceDesign && !isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            unlockGenerationCompleteSound();

            setRunningNodeId(nodeId);
            const runController = startGenerationRequest(nodeId, nodeId, nodeId);
            const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
            const selectedSourceText = options?.sourceScope === "selection" ? (textSelections[nodeId] || "").trim() : "";
            const sourceTextForGeneration = selectedSourceText || sourceTextContent;
            const derivedSourceId = sourceNode?.metadata?.sourceNodeId || (sourceNode?.type === CanvasNodeType.Text ? sourceNode.id : undefined);
            const sourceMetadata: Pick<CanvasNodeMetadata, "sourceNodeId" | "sourceScope"> = derivedSourceId ? { sourceNodeId: derivedSourceId, sourceScope: sourceNode?.metadata?.sourceScope || options?.sourceScope || "full" } : {};
            const editingTextNode = mode === "text" && Boolean(sourceTextContent);
            const mentionReferences = mentionReferencesByNodeId.get(nodeId) || [];
            const canvasReferenceOrder = mentionReferences.filter((reference) => reference.active && reference.source === "canvas").map((reference) => reference.nodeId);
            const generationPrompt = normalizeCanvasResourceMentions(editingTextNode ? `请根据要求处理以下文本。\n\n原文：\n${sourceTextForGeneration}\n\n处理要求：\n${prompt}` : prompt, mentionReferences);
            let generationContext: Awaited<ReturnType<typeof hydrateNodeGenerationContext>>;
            try {
                generationContext = await hydrateNodeGenerationContext(
                    buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, generationPrompt, mentionReferences),
                );
            } catch (error) {
                const errorDetails = error instanceof Error ? error.message : "参考图片读取失败";
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === nodeId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            const effectivePrompt = normalizeCanvasResourceMentions(generationContext.prompt, mentionReferences).trim();
            if (runController.signal.aborted) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            const markSourceStatus = sourceNode?.type !== CanvasNodeType.Image && !editingTextNode;
            const statusPrompt = prompt;
            if (!effectivePrompt && (mode === "text" || mode === "audio")) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            let pendingChildIds: string[] = [];
            if (markSourceStatus) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt: statusPrompt, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));

            try {
                if (mode === "image") {
                    const count = getGenerationCount(generationConfig.count);
                    const isImageNode = sourceNode?.type === CanvasNodeType.Image;
                    const isEmptyImageNode = isImageNode && !sourceNode?.metadata?.content;
                    const sourceReference =
                        isImageNode && sourceNode?.metadata?.content
                            ? [{ id: sourceNode.id, name: `${sourceNode.title || sourceNode.id}.png`, type: sourceNode.metadata.mimeType || "image/png", dataUrl: sourceNode.metadata.content, storageKey: sourceNode.metadata.storageKey }]
                            : [];
                    const referenceImages = sourceReference.length ? sourceReference : generationContext.referenceImages;
                    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
                    const generationMetadata = buildImageGenerationMetadata(generationType, generationConfig, count, referenceImages);
                    const parentConfig = NODE_DEFAULT_SIZE[isImageNode ? CanvasNodeType.Image : CanvasNodeType.Text];
                    const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                    const gap = 96;
                    const rowGap = 36;
                    const rootId = isEmptyImageNode ? nodeId : nanoid();
                    const childIds = count > 1 ? Array.from({ length: count }, () => nanoid()) : [];
                    const targetIds = count > 1 ? childIds : [rootId];
                    pendingChildIds = isEmptyImageNode ? childIds : [rootId, ...childIds];
                    const rootNode: CanvasNodeData = {
                        id: rootId,
                        type: CanvasNodeType.Image,
                        title: effectivePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: isEmptyImageNode ? parentPosition.x : parentPosition.x + parentConfig.width + gap,
                            y: parentPosition.y + parentConfig.height / 2 - imageConfig.height / 2,
                        },
                        width: isEmptyImageNode ? sourceNode?.width || imageConfig.width : imageConfig.width,
                        height: isEmptyImageNode ? sourceNode?.height || imageConfig.height : imageConfig.height,
                        metadata: {
                            ...(isEmptyImageNode ? sourceNode?.metadata : undefined),
                            prompt: effectivePrompt,
                            status: NODE_STATUS_LOADING,
                            ...sourceMetadata,
                            isBatchRoot: count > 1 || (isEmptyImageNode && Boolean(sourceNode?.metadata?.isBatchRoot)),
                            batchChildIds: count > 1 ? childIds : isEmptyImageNode ? sourceNode?.metadata?.batchChildIds : undefined,
                            batchUsesReferenceImages: referenceImages.length > 0,
                            ...generationMetadata,
                            imageBatchExpanded: count > 1 ? true : isEmptyImageNode ? sourceNode?.metadata?.imageBatchExpanded : undefined,
                        },
                    };
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: CanvasNodeType.Image,
                        title: effectivePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (imageConfig.width + 36),
                            y: rootNode.position.y + Math.floor(index / 2) * (imageConfig.height + rowGap),
                        },
                        width: imageConfig.width,
                        height: imageConfig.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, batchRootId: count > 1 ? rootId : undefined, ...sourceMetadata, ...generationMetadata },
                    }));
                    const batchConnections = [...(isEmptyImageNode ? [] : [{ id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]), ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId }))];

                    setNodes((prev) => [
                        ...prev.map((node) =>
                            node.id === nodeId
                                ? isEmptyImageNode
                                      ? {
                                            ...node,
                                            position: rootNode.position,
                                            width: rootNode.width,
                                            height: rootNode.height,
                                            title: rootNode.title,
                                            metadata: { ...node.metadata, ...rootNode.metadata, errorDetails: undefined },
                                        }
                                      : isImageNode
                                        ? {
                                              ...node,
                                              metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined },
                                          }
                                        : {
                                              ...node,
                                              type: CanvasNodeType.Text,
                                              title: prompt.slice(0, 32) || "Prompt",
                                              width: parentConfig.width,
                                              height: parentConfig.height,
                                              metadata: { ...node.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS, fontSize: 14, errorDetails: undefined },
                                          }
                                : node,
                        ),
                        ...(isEmptyImageNode ? [] : [rootNode]),
                        ...childNodes,
                    ]);
                    setConnections((prev) => [...prev, ...batchConnections]);
                    setSelectedNodeIds(new Set([nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(nodeId);

                    const controller = runController;
                    targetIds.forEach((targetId) => startGenerationRequest(targetId, nodeId, nodeId, controller));
                    if (count > 1) startGenerationRequest(rootId, nodeId, nodeId, controller);
                    let hasSuccess = false;
                    let hasFailure = false;
                    const generatedImages = referenceImages.length
                        ? await requestEdit(generationConfig, effectivePrompt, referenceImages, undefined, { signal: controller.signal })
                        : await requestGeneration(generationConfig, effectivePrompt, { signal: controller.signal });
                    await Promise.all(
                        targetIds.map(async (targetId, index) => {
                            try {
                                const image = generatedImages[index];
                                if (!image) throw new Error("Image generation did not return the requested item");
                                const uploaded = await uploadImage(image.dataUrl);
                                const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                                setNodes((prev) => {
                                    const root = prev.find((node) => node.id === rootId);
                                    return prev.map((node) => {
                                        if (node.id !== targetId && node.id !== rootId) return node;
                                        const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                                        if (node.id === rootId && (targetId === rootId || !root?.metadata?.primaryImageId))
                                            return {
                                                ...node,
                                                position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                                width: imageSize.width,
                                                height: imageSize.height,
                                                metadata: { ...node.metadata, ...imageMetadata(uploaded), primaryImageId: targetId },
                                            };
                                        if (node.id === targetId)
                                            return {
                                                ...node,
                                                position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                                width: imageSize.width,
                                                height: imageSize.height,
                                                metadata: { ...node.metadata, ...imageMetadata(uploaded) },
                                            };
                                        return node;
                                    });
                                });
                                hasSuccess = true;
                                return true;
                            } catch (error) {
                                if (isGenerationCanceled(error)) return false;
                                const errorDetails = error instanceof Error ? error.message : "生成失败";
                                hasFailure = true;
                                setNodes((prev) => prev.map((node) => (node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                            } finally {
                                finishGenerationRequest(targetId, controller);
                            }
                            return false;
                        }),
                    );
                    if (count > 1) finishGenerationRequest(rootId, controller);
                    if (controller.signal.aborted) return;
                    if (hasFailure) message.error(hasSuccess ? "部分图片生成失败" : "全部图片生成失败");
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === nodeId && isEmptyImageNode
                                  ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : "全部图片生成失败" } }
                                  : node.id === rootId && !hasSuccess
                                    ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails: "全部图片生成失败" } }
                                    : node,
                        ),
                    );
                    if (hasSuccess) playGenerationCompleteSound();
                    return;
                }

                if (mode === "video") {
                    const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                    const isEmptyVideoNode = sourceNode?.type === CanvasNodeType.Video && !sourceNode.metadata?.content;
                    const videoId = isEmptyVideoNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const videoNode: CanvasNodeData = {
                        id: videoId,
                        type: CanvasNodeType.Video,
                        title: effectivePrompt.slice(0, 32) || "Generated Video",
                        position: isEmptyVideoNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y },
                        width: isEmptyVideoNode ? sourceNode.width : spec.width,
                        height: isEmptyVideoNode ? sourceNode.height : spec.height,
                        metadata: {
                            prompt: effectivePrompt,
                            status: NODE_STATUS_LOADING,
                            ...sourceMetadata,
                            model: generationConfig.model,
                            size: generationConfig.size,
                            seconds: generationConfig.videoSeconds,
                            vquality: generationConfig.vquality,
                            generateAudio: generationConfig.videoGenerateAudio,
                            watermark: generationConfig.videoWatermark,
                            videoMode: generationConfig.videoMode,
                            generationRequestId: nanoid(),
                            videoProvider: isCanvasVideoModel(generationConfig) ? "canvas-video" : undefined,
                            references: generationReferenceUrls(generationContext),
                            referenceOrder: canvasReferenceOrder,
                        },
                    };
                    pendingChildIds = [videoId];
                    setNodes((prev) =>
                        isEmptyVideoNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...videoNode } : node))
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), videoNode],
                    );
                    if (!isEmptyVideoNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: videoId }]);
                    const controller = startGenerationRequest(videoId, nodeId, nodeId, runController);
                    try {
                        let video: UploadedFile | CanvasVideoStoredResult;
                        if (isCanvasVideoModel(generationConfig)) {
                            const clientRequestId = String(videoNode.metadata?.generationRequestId || nanoid());
                            logCanvasVideoReferenceDebug({
                                nodeId: videoId,
                                prompt: effectivePrompt,
                                referenceOrder: canvasReferenceOrder,
                                references: mentionReferences,
                                generationContext,
                                nodes: nodesRef.current,
                                connections: connectionsRef.current,
                            });
                            const task = await createCanvasVideoTask(generationConfig, {
                                projectId,
                                nodeId: videoId,
                                clientRequestId,
                                prompt: effectivePrompt,
                                referenceImages: generationContext.referenceImages,
                                referenceVideos: generationContext.referenceVideos,
                                referenceAudios: generationContext.referenceAudios,
                            }, controller.signal);
                            if (controller.signal.aborted) pausedVideoTaskIdsRef.current.add(task.id);
                            setNodes((prev) => prev.map((node) => node.id === videoId ? { ...node, metadata: { ...node.metadata, videoTaskId: task.id, videoProvider: "canvas-video", generationRequestId: clientRequestId, ...canvasVideoTaskMetadata(task) } } : node));
                            video = await waitForCanvasVideoTask(generationConfig, task.id, controller.signal, (state) => {
                                updateVideoHostTask(videoId, state);
                                setNodes((prev) => prev.map((node) => node.id === videoId ? { ...node, metadata: { ...node.metadata, ...canvasVideoTaskMetadata(state) } } : node));
                            });
                        } else {
                            video = await storeGeneratedVideo(
                                await requestVideoGeneration(generationConfig, effectivePrompt, generationContext.referenceImages, generationContext.referenceVideos, generationContext.referenceAudios, { signal: controller.signal }),
                            );
                        }
                        const videoSize = fitNodeSize(video.width || spec.width, video.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === videoId
                                    ? {
                                          ...node,
                                          width: videoSize.width,
                                          height: videoSize.height,
                                          position: { x: node.position.x + node.width / 2 - videoSize.width / 2, y: node.position.y + node.height / 2 - videoSize.height / 2 },
                                          metadata: {
                                              ...node.metadata,
                                               ...(isCanvasVideoModel(generationConfig) ? canvasVideoMetadata(video as CanvasVideoStoredResult) : videoMetadata(video as UploadedFile)),
                                              prompt: effectivePrompt,
                                              model: generationConfig.model,
                                              size: generationConfig.size,
                                              seconds: generationConfig.videoSeconds,
                                              vquality: generationConfig.vquality,
                                              generateAudio: generationConfig.videoGenerateAudio,
                                               watermark: generationConfig.videoWatermark,
                                               videoMode: generationConfig.videoMode,
                                              references: generationReferenceUrls(generationContext),
                                              referenceOrder: canvasReferenceOrder,
                                          },
                                      }
                                    : node,
                            ),
                        );
                        playGenerationCompleteSound();
                    } finally {
                        finishGenerationRequest(videoId, controller);
                    }
                    return;
                }

                if (mode === "audio") {
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    const isEmptyAudioNode = sourceNode?.type === CanvasNodeType.Audio && !sourceNode.metadata?.content;
                    const audioId = isEmptyAudioNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const audioNode: CanvasNodeData = {
                        id: audioId,
                        type: CanvasNodeType.Audio,
                        title: effectivePrompt.slice(0, 32) || "Generated Audio",
                        position: isEmptyAudioNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y + ((sourceNode?.height || spec.height) - spec.height) / 2 },
                        width: isEmptyAudioNode ? sourceNode.width : spec.width,
                        height: isEmptyAudioNode ? sourceNode.height : spec.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, sourceType: "tts", audioMode: isVoiceDesign ? "design" : "synthesis", voiceDesignDescription: isVoiceDesign ? effectivePrompt : undefined, ...sourceMetadata, ...buildAudioGenerationMetadata(generationConfig) },
                    };
                    pendingChildIds = [audioId];
                    setNodes((prev) =>
                        isEmptyAudioNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...audioNode } : node))
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), audioNode],
                    );
                    if (!isEmptyAudioNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: audioId }]);
                    const controller = startGenerationRequest(audioId, nodeId, nodeId, runController);
                    try {
                        const audio = await storeGeneratedAudio(
                            isVoiceDesign
                                ? await requestVoiceDesign(effectivePrompt, { signal: controller.signal })
                                : await requestAudioGeneration(generationConfig, effectivePrompt, {
                                      signal: controller.signal,
                                      referenceAudio: generationContext.referenceAudios[0],
                                      onTaskCreated: (task) => {
                                          resumedAudioTaskIdsRef.current.add(task.taskId);
                                          setNodes((prev) =>
                                              prev.map((node) => (node.id === audioId ? { ...node, metadata: { ...node.metadata, audioTaskId: task.taskId, audioEngine: task.engine, voiceId: task.voiceId, characterCount: task.characterCount } } : node)),
                                          );
                                      },
                                  }),
                            isVoiceDesign ? "wav" : generationConfig.audioFormat,
                        );
                        setNodes((prev) => prev.map((node) => (node.id === audioId ? { ...node, metadata: { ...node.metadata, ...audioMetadata(audio, "tts"), prompt: effectivePrompt, audioMode: isVoiceDesign ? "design" : "synthesis", voiceDesignDescription: isVoiceDesign ? effectivePrompt : undefined, ...buildAudioGenerationMetadata(generationConfig) } } : node)));
                        playGenerationCompleteSound();
                    } finally {
                        finishGenerationRequest(audioId, controller);
                    }
                    return;
                }

                let streamed = "";
                const textCount = 1;
                const parentConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                const textConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                const childIds = editingTextNode ? Array.from({ length: textCount }, () => nanoid()) : [];
                const requestIdByTarget = new Map<string, string>();
                pendingChildIds = childIds;
                if (editingTextNode) {
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => {
                        const generationRequestId = nanoid();
                        requestIdByTarget.set(id, generationRequestId);
                        return {
                            id,
                            type: CanvasNodeType.Text,
                            title: effectivePrompt.slice(0, 32) || "Generated Text",
                            position: {
                                x: parentPosition.x + parentConfig.width + 96,
                                y: parentPosition.y + parentConfig.height / 2 - textConfig.height / 2 + (index - (textCount - 1) / 2) * (textConfig.height + 36),
                            },
                            width: textConfig.width,
                            height: textConfig.height,
                            metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, fontSize: 14, sourceNodeId: nodeId, sourceOperation: options?.operation, sourceScope: options?.sourceScope || "full", generationRequestId },
                        };
                    });
                    setNodes((prev) => [...prev, ...childNodes]);
                    setConnections((prev) => [...prev, ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: childId }))]);
                }

                const controller = runController;
                const textTargetIds = childIds.length ? childIds : [nodeId];
                textTargetIds.forEach((targetNodeId) => startGenerationRequest(targetNodeId, nodeId, nodeId, controller));
                const answers = await Promise.all(
                    textTargetIds.map((targetNodeId) => {
                        let localStreamed = "";
                        const input = buildNodeResponseMessages({ ...generationContext, prompt: effectivePrompt });
                        const complete = userConnection
                            ? canvasTextApi
                                  .complete(userConnection, { requestId: requestIdByTarget.get(targetNodeId) || nanoid(), input, model: modelOptionName(generationConfig.model), operation: options?.operation, sourceNodeId: nodeId }, controller.signal)
                                  .then((result) => result.outputText)
                            : requestImageQuestion(
                                  generationConfig,
                                  input,
                                  (text) => {
                                  localStreamed = text;
                                  streamed = text;
                                  setNodes((prev) => prev.map((node) => (node.id === targetNodeId ? { ...node, type: CanvasNodeType.Text, metadata: { ...node.metadata, content: text, status: NODE_STATUS_LOADING } } : node)));
                                  },
                                  { signal: controller.signal },
                              );
                        return complete.then((answer) => ({ nodeId: targetNodeId, content: answer || localStreamed })).finally(() => finishGenerationRequest(targetNodeId, controller));
                    }),
                );
                if (controller.signal.aborted) return;
                const answerByNodeId = new Map(answers.map((item) => [item.nodeId, item.content]));
                setNodes((prev) =>
                    prev.map((node) =>
                        childIds.includes(node.id)
                            ? { ...node, metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, status: NODE_STATUS_SUCCESS } }
                            : node.id === nodeId && !editingTextNode
                                ? { ...node, type: CanvasNodeType.Text, title: prompt.slice(0, 32) || "Generated Text", metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, status: NODE_STATUS_SUCCESS } }
                                : node,
                    ),
                );
                playGenerationCompleteSound();
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((node) => (node.id === nodeId || pendingChildIds.includes(node.id) ? (node.id === nodeId && !markSourceStatus ? node : { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } }) : node)),
                );
            } finally {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, mentionReferencesByNodeId, modal, openConfigDialog, startGenerationRequest, textSelections, userAssets, userConnection],
    );
    useEffect(() => {
        generateNodeRef.current = handleGenerateNode;
    }, [handleGenerateNode]);

    const handleRetryNode = useCallback(
        async (node: CanvasNodeData) => {
            const sourceNode = node;
            const isVoiceDesign = node.type === CanvasNodeType.Audio && node.metadata?.audioMode === "design";
            const batchRoot = node.metadata?.batchRootId ? nodesRef.current.find((item) => item.id === node.metadata?.batchRootId) : null;
            const savedImageMetadata = node.type === CanvasNodeType.Image ? { ...batchRoot?.metadata, ...node.metadata } : undefined;
            const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
            const generationConfig =
                hasSavedImageMetadata && savedImageMetadata
                    ? {
                          ...effectiveConfig,
                          model: savedImageMetadata.model || effectiveConfig.imageModel || effectiveConfig.model,
                          quality: savedImageMetadata.quality || effectiveConfig.quality,
                          size: savedImageMetadata.size || effectiveConfig.size,
                          count: "1",
                      }
                    : { ...buildGenerationConfig(effectiveConfig, sourceNode, node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image"), count: "1" };
            if (!isVoiceDesign && !isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            const mentionReferences = mentionReferencesByNodeId.get(sourceNode.id) || [];
            const savedPrompt = savedImageMetadata?.prompt || sourceNode.metadata?.prompt || node.metadata?.prompt || "";
            const context = hasSavedImageMetadata ? null : await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, normalizeCanvasResourceMentions(savedPrompt, mentionReferences), mentionReferences));
            const prompt = normalizeCanvasResourceMentions(savedImageMetadata?.prompt || context?.prompt || "", mentionReferences).trim();
            if (!prompt) {
                message.warning("找不到提示词，无法重试");
                return;
            }
            const generationType = savedImageMetadata?.generationType;
            const useReferenceImages = generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const retryReferenceImages =
                hasSavedImageMetadata && savedImageMetadata ? await resolveMetadataReferences(savedImageMetadata) : useReferenceImages ? (context?.referenceImages.length ? context.referenceImages : sourceNodeReferenceImages(batchRoot || sourceNode)) : [];
            if (useReferenceImages && !retryReferenceImages) {
                message.error("参考图片已丢失，无法继续重试");
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: "参考图片已丢失，无法继续重试" } } : item)));
                return;
            }
            const retryImages = retryReferenceImages || [];

            setRunningNodeId(node.id);
            unlockGenerationCompleteSound();
            const retryReferenceOrder = mentionReferences.filter((reference) => reference.active && reference.source === "canvas").map((reference) => reference.nodeId);
            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined, referenceOrder: item.metadata?.referenceOrder?.length ? item.metadata.referenceOrder : retryReferenceOrder } } : item)));
            const controller = startGenerationRequest(node.id, sourceNode.id, node.id);

            try {
                if (node.type === CanvasNodeType.Text) {
                    if (!context) return;
                    let streamed = "";
                    const answer = await requestImageQuestion(
                        generationConfig,
                        buildNodeResponseMessages({ ...context, prompt }),
                        (text) => {
                        streamed = text;
                        setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: text, status: NODE_STATUS_LOADING } } : item)));
                        },
                        { signal: controller.signal },
                    );
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: answer || streamed, prompt, status: NODE_STATUS_SUCCESS } } : item)));
                    playGenerationCompleteSound();
                    return;
                }
                if (node.type === CanvasNodeType.Video) {
                    let video: UploadedFile | CanvasVideoStoredResult;
                    if (isCanvasVideoModel(generationConfig)) {
                        const clientRequestId = nanoid();
                        setNodes((prev) => prev.map((item) => item.id === node.id ? { ...item, metadata: { ...item.metadata, content: undefined, status: NODE_STATUS_LOADING, generationRequestId: clientRequestId, videoTaskId: undefined, videoProvider: "canvas-video", serverStorageKey: undefined } } : item));
                        const task = await createCanvasVideoTask(generationConfig, {
                            projectId,
                            nodeId: node.id,
                            clientRequestId,
                            prompt,
                            referenceImages: retryImages,
                            referenceVideos: context?.referenceVideos || [],
                            referenceAudios: context?.referenceAudios || [],
                        }, controller.signal);
                        if (controller.signal.aborted) pausedVideoTaskIdsRef.current.add(task.id);
                        setNodes((prev) => prev.map((item) => item.id === node.id ? { ...item, metadata: { ...item.metadata, videoTaskId: task.id, videoProvider: "canvas-video", ...canvasVideoTaskMetadata(task) } } : item));
                        video = await waitForCanvasVideoTask(generationConfig, task.id, controller.signal, (state) => {
                            updateVideoHostTask(node.id, state);
                            setNodes((prev) => prev.map((item) => item.id === node.id ? { ...item, metadata: { ...item.metadata, ...canvasVideoTaskMetadata(state) } } : item));
                        });
                    } else {
                        video = await storeGeneratedVideo(await requestVideoGeneration(generationConfig, prompt, retryImages, context?.referenceVideos || [], context?.referenceAudios || [], { signal: controller.signal }));
                    }
                    const videoSize = fitNodeSize(video.width || node.width, video.height || node.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) =>
                        prev.map((item) =>
                            item.id === node.id
                                ? {
                                      ...item,
                                      width: videoSize.width,
                                      height: videoSize.height,
                                      position: { x: item.position.x + item.width / 2 - videoSize.width / 2, y: item.position.y + item.height / 2 - videoSize.height / 2 },
                                      metadata: {
                                          ...item.metadata,
                                           ...(isCanvasVideoModel(generationConfig) ? canvasVideoMetadata(video as CanvasVideoStoredResult) : videoMetadata(video as UploadedFile)),
                                          prompt,
                                          model: generationConfig.model,
                                          size: generationConfig.size,
                                          seconds: generationConfig.videoSeconds,
                                          vquality: generationConfig.vquality,
                                          generateAudio: generationConfig.videoGenerateAudio,
                                           watermark: generationConfig.videoWatermark,
                                           videoMode: generationConfig.videoMode,
                                      },
                                  }
                                : item,
                        ),
                    );
                    playGenerationCompleteSound();
                    return;
                }
                if (node.type === CanvasNodeType.Audio) {
                    const audio = await storeGeneratedAudio(
                        isVoiceDesign
                            ? await requestVoiceDesign(prompt, { signal: controller.signal })
                            : await requestAudioGeneration(generationConfig, prompt, {
                                  signal: controller.signal,
                                  referenceAudio: context?.referenceAudios[0],
                                  onTaskCreated: (task) => {
                                      resumedAudioTaskIdsRef.current.add(task.taskId);
                                      setNodes((prev) =>
                                          prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, audioTaskId: task.taskId, audioEngine: task.engine, voiceId: task.voiceId, characterCount: task.characterCount } } : item)),
                                      );
                                  },
                              }),
                        isVoiceDesign ? "wav" : generationConfig.audioFormat,
                    );
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...audioMetadata(audio, "tts"), prompt, audioMode: isVoiceDesign ? "design" : "synthesis", voiceDesignDescription: isVoiceDesign ? prompt : undefined, ...buildAudioGenerationMetadata(generationConfig) } } : item)));
                    playGenerationCompleteSound();
                    return;
                }

                const image = useReferenceImages
                    ? await requestEdit(generationConfig, prompt, retryImages, undefined, { signal: controller.signal }).then((items) => items[0])
                    : await requestGeneration(generationConfig, prompt, { signal: controller.signal }).then((items) => items[0]);
                const uploadedImage = await uploadImage(image.dataUrl);
                const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                const imageSize = fitNodeSize(uploadedImage.width, uploadedImage.height, imageConfig.width, imageConfig.height);
                const generationMetadata = savedImageMetadata?.generationType
                    ? { generationType: savedImageMetadata.generationType, model: generationConfig.model, size: generationConfig.size, quality: generationConfig.quality, count: savedImageMetadata.count || 1, references: savedImageMetadata.references }
                    : buildImageGenerationMetadata(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryImages);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  type: CanvasNodeType.Image,
                                  width: imageSize.width,
                                  height: imageSize.height,
                                  metadata: { ...item.metadata, ...imageMetadata(uploadedImage), prompt, ...generationMetadata },
                              }
                            : item,
                    ),
                );
                playGenerationCompleteSound();
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(node.id, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
    );

    const generateImageFromTextNode = useCallback(
        (node: CanvasNodeData) => {
            const prompt = (textSelections[node.id] || node.metadata?.content || node.metadata?.prompt || "").trim();
            if (!prompt) {
                message.warning("文本节点为空，无法生图");
                return;
            }
            const sourceNode = nodesRef.current.find((item) => item.id === node.id);
            if (!sourceNode) return;
            const nodeSize = getNodeSpec(CanvasNodeType.Image);
            const imageNode = createCanvasNode(
                CanvasNodeType.Image,
                {
                    x: sourceNode.position.x + sourceNode.width + 96 + nodeSize.width / 2,
                    y: sourceNode.position.y + sourceNode.height / 2,
                },
                {
                    prompt,
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    size: effectiveConfig.size,
                    count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                    sourceNodeId: sourceNode.id,
                    sourceScope: textSelections[node.id] ? "selection" : "full",
                },
            );
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: imageNode.id };
            const nextNodes = [...nodesRef.current, imageNode];
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([imageNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(imageNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message, textSelections],
    );

    const generateMediaFromTextNode = useCallback(
        (node: CanvasNodeData, mode: "image" | "audio" | "video") => {
            if (mode === "image") {
                generateImageFromTextNode(node);
                return;
            }
            const sourceNode = nodesRef.current.find((item) => item.id === node.id);
            const prompt = (textSelections[node.id] || sourceNode?.metadata?.content || "").trim();
            if (!sourceNode || !prompt) {
                message.warning("文本节点为空，无法创建媒体节点");
                return;
            }
            const type = mode === "audio" ? CanvasNodeType.Audio : CanvasNodeType.Video;
            const spec = NODE_DEFAULT_SIZE[type];
            const createdNode = createCanvasNode(
                type,
                { x: sourceNode.position.x + sourceNode.width + 96 + spec.width / 2, y: sourceNode.position.y + sourceNode.height / 2 },
                mode === "audio"
                    ? {
                          prompt,
                          sourceType: "tts",
                          model: effectiveConfig.audioModel,
                          audioVoice: effectiveConfig.audioVoice,
                          audioVoiceName: effectiveConfig.audioVoiceName,
                          audioFormat: effectiveConfig.audioFormat,
                          audioSpeed: effectiveConfig.audioSpeed,
                          audioInstructions: effectiveConfig.audioInstructions,
                          sourceNodeId: sourceNode.id,
                          sourceScope: textSelections[node.id] ? "selection" : "full",
                      }
                    : {
                          prompt,
                          model: effectiveConfig.videoModel,
                          size: effectiveConfig.size,
                          seconds: effectiveConfig.videoSeconds,
                          vquality: effectiveConfig.vquality,
                          generateAudio: effectiveConfig.videoGenerateAudio,
                           watermark: effectiveConfig.videoWatermark,
                           videoMode: effectiveConfig.videoMode,
                          sourceNodeId: sourceNode.id,
                          sourceScope: textSelections[node.id] ? "selection" : "full",
                      },
            );
            const newNode = { ...createdNode, title: mode === "audio" ? "配音" : "视频" };
            const nextNodes = [...nodesRef.current, newNode];
            const nextConnections = [...connectionsRef.current, { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: newNode.id }];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(newNode.id);
        },
        [
            effectiveConfig.audioFormat,
            effectiveConfig.audioInstructions,
            effectiveConfig.audioModel,
            effectiveConfig.audioSpeed,
            effectiveConfig.audioVoice,
            effectiveConfig.audioVoiceName,
            effectiveConfig.size,
            effectiveConfig.videoGenerateAudio,
            effectiveConfig.videoModel,
            effectiveConfig.videoSeconds,
            effectiveConfig.videoWatermark,
            effectiveConfig.videoMode,
            effectiveConfig.vquality,
            generateImageFromTextNode,
            message,
            textSelections,
            userAssets,
        ],
    );

    const insertAssistantImage = useCallback(
        async (image: CanvasAssistantImage) => {
            const storedImage = image.storageKey ? { url: image.dataUrl, storageKey: image.storageKey, width: 1, height: 1, bytes: 0, mimeType: "image/png" } : await uploadImage(image.dataUrl);
            const meta = storedImage.width === 1 && storedImage.height === 1 ? await readImageMeta(storedImage.url) : storedImage;
            const config = fitNodeSize(meta.width, meta.height);
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node: CanvasNodeData = {
                id,
                type: CanvasNodeType.Image,
                title: image.prompt.slice(0, 32) || "Generated Image",
                position: { x: center.x - config.width / 2, y: center.y - config.height / 2 },
                width: config.width,
                height: config.height,
                metadata: { ...imageMetadata({ ...storedImage, width: meta.width, height: meta.height }), prompt: image.prompt },
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
            setDialogNodeId(id);
        },
        [screenToCanvas, size.height, size.width],
    );

    const insertAssistantText = useCallback(
        (text: string) => {
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const node = {
                ...createCanvasNode(CanvasNodeType.Text, center, { content: text, status: NODE_STATUS_SUCCESS }),
                title: text.slice(0, 32) || "Assistant Text",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
        },
        [screenToCanvas, size.height, size.width],
    );

    const handleAssetInsert = useCallback(
        (payload: InsertAssetPayload) => {
            if (payload.kind === "text") {
                insertAssistantText(payload.content);
            } else if (payload.kind === "video") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const nextSize = fitNodeSize(payload.width || spec.width, payload.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                setNodes((prev) => [
                    ...prev,
                    {
                        id,
                        type: CanvasNodeType.Video,
                        title: payload.title,
                        position: { x: center.x - nextSize.width / 2, y: center.y - nextSize.height / 2 },
                        width: nextSize.width,
                        height: nextSize.height,
                        metadata: { content: payload.url, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS, naturalWidth: payload.width, naturalHeight: payload.height },
                    },
                ]);
                setSelectedNodeIds(new Set([id]));
            } else {
                insertAssistantImage({ id: `asset-${Date.now()}`, prompt: payload.title, dataUrl: payload.dataUrl, storageKey: payload.storageKey });
            }
            setAssetPickerOpen(false);
        },
        [insertAssistantImage, insertAssistantText, screenToCanvas, size.height, size.width],
    );

    const handleViewportChange = useCallback((next: ViewportTransform) => {
        viewportRef.current = next;
        setViewport(next);
        setContextMenu(null);
    }, []);

    const handleViewportInteractionStart = useCallback(() => {
        setContextMenu(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
    }, []);

    const renderCanvasNodePanel = useCallback(
        (panelNode: CanvasNodeData) =>
            getNodeDefinition(panelNode.type)?.Panel ? (
                renderPluginPanel(panelNode)
            ) : (
                <CanvasNodePromptPanel
                    node={panelNode}
                    isRunning={runningNodeId === panelNode.id}
                    selectedText={textSelections[panelNode.id] || ""}
                    mentionReferences={mentionReferencesByNodeId.get(panelNode.id) || EMPTY_RESOURCE_REFERENCES}
                    onPromptChange={handleNodePromptChange}
                    onConfigChange={handleConfigNodeChange}
                    onGenerate={handleGenerateNode}
                    onStop={confirmStopGeneration}
                    onImageSettingsOpenChange={(open) => {
                        setNodeImageSettingsOpen(open);
                        if (open) setToolbarNodeId(null);
                    }}
                />
            ),
        [confirmStopGeneration, handleConfigNodeChange, handleGenerateNode, handleNodePromptChange, mentionReferencesByNodeId, renderPluginPanel, runningNodeId, textSelections],
    );

    const handleCanvasNodeHoverStart = useCallback((nodeId: string) => {
        if (!nodeDraggingRef.current) setHoveredNodeId(nodeId);
    }, []);
    const handleCanvasNodeHoverEnd = useCallback((nodeId: string) => {
        setHoveredNodeId((current) => (current === nodeId ? null : current));
    }, []);
    const handleCanvasNodeOpenPanel = useCallback((nodeId: string) => setDialogNodeId(nodeId), []);
    const handleCanvasNodeRetry = useCallback((node: CanvasNodeData) => void handleRetryNode(node), [handleRetryNode]);
    const handleCanvasNodeViewImage = useCallback((node: CanvasNodeData) => setPreviewNodeId(node.id), []);
    const handleCanvasNodeContextMenu = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId });
    }, []);
    const handleConnectionSelect = useCallback((connectionId: string) => {
        setSelectedConnectionId(connectionId);
        setSelectedNodeIds(new Set());
        setContextMenu(null);
    }, []);
    const handleConnectionContextMenu = useCallback((event: ReactMouseEvent<SVGPathElement>, connectionId: string) => {
        setSelectedConnectionId(connectionId);
        setSelectedNodeIds(new Set());
        setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId });
    }, []);

    if (!projectLoaded) return <CanvasRefreshShell />;

    return (
        <main className="flex h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <CanvasSidePanel nodes={nodes} selectedNodeIds={selectedNodeIds} onFocusNode={focusNode} onInsertAsset={handleAssetInsert} />
            <section className="relative min-w-0 flex-1 overflow-hidden">
                <CanvasTopBar
                    title={currentProjectTitle || "未命名画布"}
                    titleDraft={titleDraft}
                    isTitleEditing={titleEditing}
                    onTitleDraftChange={setTitleDraft}
                    onStartTitleEditing={startTitleEditing}
                    onFinishTitleEditing={finishTitleEditing}
                    onCancelTitleEditing={() => setTitleEditing(false)}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    onHome={() => navigate("/")}
                    onProjects={() => navigate("/canvas")}
                    onCreateProject={createAndOpenProject}
                    onDeleteProject={deleteCurrentProject}
                    onImportImage={() => handleUploadRequest()}
                    onOpenPlugins={SHOW_CANVAS_PLUGIN_UI ? () => setPluginManagerOpen(true) : undefined}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    agentOpen={agentPanelOpen}
                    compactAgentStatus={{ connected: localAgentConnected, enabled: localAgentEnabled, activity: localAgentActivity }}
                    onToggleAgent={toggleAgentPanel}
                />

                <InfiniteCanvas
                    containerRef={containerRef}
                    viewport={viewport}
                    backgroundMode={backgroundMode}
                    panMode={panMode}
                    onViewportChange={handleViewportChange}
                    onViewportInteractionStart={handleViewportInteractionStart}
                    onCanvasMouseDown={handleCanvasMouseDown}
                    onCanvasDeselect={deselectCanvas}
                    onCanvasDoubleClick={(event) => {
                        setContextMenu(null);
                        setNodeCreatePosition(screenToCanvas(event.clientX, event.clientY));
                    }}
                    onContextMenu={preventCanvasContextMenu}
                    onDrop={handleDrop}
                >
                    <svg className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible" style={{ pointerEvents: "none", transform: "translateZ(0)", zIndex: 0 }}>
                        {visibleConnections.map((connection) => {
                            const from = nodeById.get(connection.fromNodeId);
                            const to = nodeById.get(connection.toNodeId);
                            if (!from || !to) return null;

                            return (
                                <ConnectionPath
                                    key={connection.id}
                                    connection={connection}
                                    from={from}
                                    to={to}
                                    active={selectedConnectionId === connection.id || relatedHighlight.connectionIds.has(connection.id)}
                                    onSelect={handleConnectionSelect}
                                    onContextMenu={handleConnectionContextMenu}
                                />
                            );
                        })}
                        {connectingParams ? <ActiveConnectionPath node={nodeById.get(connectingParams.nodeId)} handle={connectingParams} mouseWorld={mouseWorld} target={connectionTargetNodeId ? nodeById.get(connectionTargetNodeId) : undefined} /> : null}
                        {batchConnectionPreview || batchConnectingPreview
                            ? (batchConnectionPreview?.connections || batchConnectingPreview)!.map((handle) => (
                                  <ActiveConnectionPath
                                      key={`batch-${handle.nodeId}`}
                                      node={nodeById.get(handle.nodeId)}
                                      handle={handle}
                                      mouseWorld={batchConnectionPreview ? batchConnectionPreview.anchorPosition || batchConnectionPreview.position : mouseWorld}
                                      target={connectionTargetNodeId ? nodeById.get(connectionTargetNodeId) : undefined}
                                  />
                              ))
                            : null}
                    </svg>

                    {visibleNodes.map((node) => (
                        <CanvasNode
                            key={node.id}
                            data={node}
                            scale={viewport.k}
                            isSelected={selectedNodeIds.has(node.id)}
                            isRelated={relatedHighlight.nodeIds.has(node.id)}
                            isFocusRelated={activeNodeId === node.id}
                            isConnectionTarget={connectionTargetNodeId === node.id}
                            isConnecting={Boolean(connectingParams || batchConnectingParams)}
                            hideConnectionHandles={batchConnectionNodes.length > 1}
                            editRequestNonce={editingNodeId === node.id ? editRequestNonce : 0}
                            showPanel={dialogNodeId === node.id && !selectionBox && !getNodeDefinition(node.type)?.hidePanel}
                            batchCount={batchChildCountById.get(node.id) || 0}
                            groupChildCount={groupChildCountById.get(node.id) || 0}
                            isGroupDropTarget={dropTargetGroupId === node.id}
                            batchExpanded={Boolean(node.metadata?.imageBatchExpanded)}
                            batchClosing={Boolean(node.metadata?.batchRootId && collapsingBatchIds.has(node.metadata.batchRootId))}
                            batchOpening={openingBatchIds.has(node.id)}
                            batchRecovering={collapsingBatchIds.has(node.id)}
                            batchMotion={batchMotionById.get(node.id)}
                            isBatchPrimary={Boolean(node.metadata?.batchRootId && nodeById.get(node.metadata.batchRootId)?.metadata?.primaryImageId === node.id)}
                            showImageInfo={showImageInfo}
                            resourceLabel={resourceReferenceByNodeId.get(node.id)}
                            mentionReferences={mentionReferencesByNodeId.get(node.id) || EMPTY_RESOURCE_REFERENCES}
                            pluginHost={pluginHost}
                            registryVersion={nodeRegistryVersion}
                            renderPanel={renderCanvasNodePanel}
                            onMouseDown={handleNodeMouseDown}
                            onSelectCapture={handleNodeSelectCapture}
                            onHoverStart={handleCanvasNodeHoverStart}
                            onHoverEnd={handleCanvasNodeHoverEnd}
                            onConnectStart={handleConnectStart}
                            onResize={handleNodeResize}
                            onContentChange={handleNodeContentChange}
                            onTextSelectionChange={handleTextSelectionChange}
                            onOpenPanel={handleCanvasNodeOpenPanel}
                            onTitleChange={handleNodeTitleChange}
                            onGroupColorChange={handleGroupColorChange}
                            onToggleBatch={toggleBatchExpanded}
                            onSetBatchPrimary={setBatchPrimary}
                            onRetry={handleCanvasNodeRetry}
                            onViewImage={handleCanvasNodeViewImage}
                            onContextMenu={handleCanvasNodeContextMenu}
                        />
                    ))}

                    {batchSelectionBounds && !isNodeDragging ? (
                        <div
                            data-canvas-multi-selection
                            className="pointer-events-none absolute z-[60] border border-dashed"
                            style={{
                                left: batchSelectionBounds.left - 12 / Math.max(viewport.k, 0.05),
                                top: batchSelectionBounds.top - 12 / Math.max(viewport.k, 0.05),
                                width: batchSelectionBounds.right - batchSelectionBounds.left + 24 / Math.max(viewport.k, 0.05),
                                height: batchSelectionBounds.bottom - batchSelectionBounds.top + 24 / Math.max(viewport.k, 0.05),
                                borderWidth: `${1 / Math.max(viewport.k, 0.05)}px`,
                                borderColor: theme.canvas.selectionStroke,
                            }}
                        >
                            <button
                                type="button"
                                data-canvas-multi-connect
                                data-canvas-no-zoom
                                className={`pointer-events-auto absolute top-1/2 grid place-items-center rounded-full border shadow-lg transition-[background-color] duration-150 ${batchConnectingParams ? "cursor-grabbing" : "cursor-grab"}`}
                                style={{
                                    right: `${-33 / Math.max(viewport.k, 0.05)}px`,
                                    width: `${30 / Math.max(viewport.k, 0.05)}px`,
                                    height: `${30 / Math.max(viewport.k, 0.05)}px`,
                                    borderWidth: `${1.25 / Math.max(viewport.k, 0.05)}px`,
                                    background: theme.node.panel,
                                    borderColor: theme.canvas.selectionStroke,
                                    color: theme.node.text,
                                    transform: batchConnectingParams
                                        ? `translate(${mouseWorld.x - (batchSelectionBounds.right + 30 / Math.max(viewport.k, 0.05))}px, ${mouseWorld.y - (batchSelectionBounds.top + batchSelectionBounds.bottom) / 2}px) translateY(-50%)`
                                        : "translateY(-50%)",
                                }}
                                aria-label={`连接选中的 ${batchConnectionNodes.length} 个节点`}
                                title={`连接选中的 ${batchConnectionNodes.length} 个节点`}
                                onPointerDown={handleBatchConnectionStart}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                    if (suppressBatchConnectClickRef.current) {
                                        suppressBatchConnectClickRef.current = false;
                                        event.preventDefault();
                                        event.stopPropagation();
                                        return;
                                    }
                                    startBatchConnectionCreate(event);
                                }}
                            >
                                <Plus style={{ width: `${19 / Math.max(viewport.k, 0.05)}px`, height: `${19 / Math.max(viewport.k, 0.05)}px` }} strokeWidth={1.9} />
                            </button>
                        </div>
                    ) : null}

                    {selectionBox ? (
                        <div
                            className="pointer-events-none absolute z-[100] border"
                            style={{
                                left: Math.min(selectionBox.startWorldX, selectionBox.currentWorldX),
                                top: Math.min(selectionBox.startWorldY, selectionBox.currentWorldY),
                                width: Math.abs(selectionBox.currentWorldX - selectionBox.startWorldX),
                                height: Math.abs(selectionBox.currentWorldY - selectionBox.startWorldY),
                                borderColor: theme.canvas.selectionStroke,
                                background: theme.canvas.selectionFill,
                            }}
                        />
                    ) : null}
                    {pendingConnectionCreate ? <ConnectionCreateMenu pending={pendingConnectionCreate} scale={viewport.k} onCreate={(type) => createConnectedNode(type, pendingConnectionCreate)} onClose={cancelPendingConnectionCreate} /> : null}
                    {nodeCreatePosition ? (
                        <NodeCreateMenu
                            position={nodeCreatePosition}
                            scale={viewport.k}
                            onCreate={(type) => {
                                createNode(type, nodeCreatePosition);
                                setNodeCreatePosition(null);
                            }}
                            onClose={() => setNodeCreatePosition(null)}
                        />
                    ) : null}
                </InfiniteCanvas>

                {nodes.length === 0 && !nodeCreatePosition ? (
                    <div className="pointer-events-none absolute inset-0 z-[40] flex items-center justify-center pb-24">
                        <EmptyCanvasGuide onCreate={(type) => createNode(type, getCanvasCenter())} />
                    </div>
                ) : null}

                <CanvasNodeHoverToolbar
                    node={isNodeDragging || nodeImageSettingsOpen ? null : toolbarNode}
                    viewport={viewport}
                    extraTools={toolbarNode ? getNodeDefinition(toolbarNode.type)?.toolbar?.(buildNodeContext(pluginHost, toolbarNode, theme, viewport.k)) : undefined}
                    onKeep={keepNodeToolbar}
                    onLeave={hideNodeToolbar}
                    onInfo={(node) => setInfoNodeId(node.id)}
                    onEditText={openTextEditor}
                    onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(10, (node.metadata?.fontSize || 14) - 2))}
                    onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || 14) + 2))}
                    onToggleDialog={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                    onGenerateMedia={generateMediaFromTextNode}
                    onUpload={(node) => handleUploadRequest(node.id)}
                    onDownload={downloadNodeImage}
                    onSaveAsset={(node) => void saveNodeAsset(node)}
                    onMaskEdit={(node) => setMaskEditNodeId(node.id)}
                    onCrop={(node) => setCropNodeId(node.id)}
                    onSplit={(node) => setSplitNodeId(node.id)}
                    onUpscale={(node) => setUpscaleNodeId(node.id)}
                    onSuperResolve={(node) => setSuperResolveNodeId(node.id)}
                    onAngle={(node) => setAngleNodeId(node.id)}
                    onViewImage={(node) => setPreviewNodeId(node.id)}
                    onReversePrompt={createImageReversePromptNodes}
                    onRetry={(node) => void handleRetryNode(node)}
                    onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                    onDelete={(node) => deleteNodes(new Set([node.id]))}
                />

                <CanvasToolbar
                    selectedCount={selectedNodeIds.size}
                    panMode={panMode}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    backgroundMode={backgroundMode}
                    showImageInfo={showImageInfo}
                    onAddImage={() => createNode(CanvasNodeType.Image)}
                    onAddVideo={() => createNode(CanvasNodeType.Video)}
                    onAddAudio={() => createNode(CanvasNodeType.Audio)}
                    onAddText={() => createNode(CanvasNodeType.Text)}
                    onAddGroup={groupSelectedNodes}
                    onAddAssetExtraction={() => createNode(CanvasNodeType.AssetExtraction)}
                    onAddExtensionNode={(type) => createNode(type)}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    onUpload={() => handleUploadRequest()}
                    onOpenAssets={() => setAssetPickerOpen(true)}
                    onDelete={() => deleteNodes(new Set(selectedNodeIds))}
                    onClear={() => setClearConfirmOpen(true)}
                    onPanModeChange={setPanMode}
                    onBackgroundModeChange={setBackgroundMode}
                    onShowImageInfoChange={setShowImageInfo}
                />

                {isMiniMapOpen ? <Minimap nodes={nodes} viewport={viewport} viewportSize={size} onViewportChange={setViewport} /> : null}

                <CanvasZoomControls scale={viewport.k} onScaleChange={setZoomScale} onReset={resetViewport} isMiniMapOpen={isMiniMapOpen} onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)} onOpenAssets={() => setAssetPickerOpen(true)} />

                {contextMenu ? (
                    <CanvasNodeContextMenu
                        menu={contextMenu}
                        canDuplicate={contextMenu.type !== "node" || ![CanvasNodeType.AssetExtraction, CanvasNodeType.ScriptAsset].includes(nodes.find((node) => node.id === contextMenu.nodeId)?.type as CanvasNodeType)}
                        onClose={() => setContextMenu(null)}
                        onDuplicate={() => {
                            if (contextMenu.type !== "node") return;
                            duplicateNode(contextMenu.nodeId);
                            setContextMenu(null);
                        }}
                        onDelete={() => {
                            if (contextMenu.type === "node") {
                                deleteNodes(new Set([contextMenu.nodeId]));
                            } else {
                                deleteConnection(contextMenu.connectionId);
                            }
                            setContextMenu(null);
                        }}
                    />
                ) : null}

                <input ref={imageInputRef} type="file" multiple accept="image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" className="hidden" onChange={handleImageInputChange} />

                <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} />
                {SHOW_CANVAS_PLUGIN_UI ? <CanvasPluginManagerModal open={pluginManagerOpen} onClose={() => setPluginManagerOpen(false)} /> : null}

                {cropNode?.metadata?.content ? <CanvasNodeCropDialog dataUrl={cropNode.metadata.content} open={Boolean(cropNode)} onClose={() => setCropNodeId(null)} onConfirm={(crop) => void cropImageNode(cropNode!, crop)} /> : null}

                {maskEditNode?.metadata?.content ? (
                    <CanvasNodeMaskEditDialog dataUrl={maskEditNode.metadata.content} open={Boolean(maskEditNode)} onClose={() => setMaskEditNodeId(null)} onConfirm={(payload) => void maskEditImageNode(maskEditNode!, payload)} />
                ) : null}

                {splitNode?.metadata?.content ? <CanvasNodeSplitDialog dataUrl={splitNode.metadata.content} open={Boolean(splitNode)} onClose={() => setSplitNodeId(null)} onConfirm={(params) => void splitImageNode(splitNode!, params)} /> : null}

                {upscaleNode?.metadata?.content ? (
                    <CanvasNodeUpscaleDialog dataUrl={upscaleNode.metadata.content} open={Boolean(upscaleNode)} onClose={() => setUpscaleNodeId(null)} onConfirm={(params) => void upscaleImageNode(upscaleNode!, params)} />
                ) : null}

                <Modal title="AI 超分" open={Boolean(superResolveNode?.metadata?.content)} centered footer={null} onCancel={() => setSuperResolveNodeId(null)}>
                    <div className="py-8 text-center text-base font-medium">暂未实现</div>
                </Modal>

                {angleNode?.metadata?.content ? <CanvasNodeAngleDialog dataUrl={angleNode.metadata.content} open={Boolean(angleNode)} onClose={() => setAngleNodeId(null)} onConfirm={(params) => void generateAngleNode(angleNode!, params)} /> : null}

                <Modal
                    title={previewNode?.type === CanvasNodeType.Text ? previewNode.title || "文本预览" : "图片详情"}
                    open={Boolean(previewNode && (previewNode.type === CanvasNodeType.Text || previewNode.metadata?.content))}
                    centered
                    onCancel={() => setPreviewNodeId(null)}
                    footer={null}
                    width={previewNode?.type === CanvasNodeType.Text ? 760 : "auto"}
                    styles={{ body: { padding: previewNode?.type === CanvasNodeType.Text ? 20 : 0, display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "80vh" } }}
                >
                    {previewNode?.type === CanvasNodeType.Text ? (
                        <div className="thin-scrollbar max-h-[72vh] w-full overflow-y-auto whitespace-pre-wrap break-words rounded-lg border p-5 font-mono text-sm leading-7" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}>
                            {previewNode.metadata?.content || "暂无文本内容"}
                        </div>
                    ) : previewNode?.metadata?.content ? <img src={previewNode.metadata.content} alt={previewNode.title || "图片"} style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }} /> : null}
                </Modal>

                <Modal
                    title="清空画布？"
                    open={clearConfirmOpen}
                    centered
                    onCancel={() => setClearConfirmOpen(false)}
                    footer={
                        <>
                            <Button onClick={() => setClearConfirmOpen(false)}>取消</Button>
                            <Button danger type="primary" onClick={clearCanvas}>
                                清空
                            </Button>
                        </>
                    }
                >
                    <p className="text-sm opacity-60">这会删除当前画布上的所有节点和连线。</p>
                </Modal>

                <AssetPickerModal open={assetPickerOpen} defaultKind="image" onInsert={handleAssetInsert} onClose={() => setAssetPickerOpen(false)} />
            </section>
        </main>
    );
}

function CanvasTopBar({
    title,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    canUndo,
    canRedo,
    onHome,
    onProjects,
    onCreateProject,
    onDeleteProject,
    onImportImage,
    onOpenPlugins,
    onUndo,
    onRedo,
    agentOpen,
    compactAgentStatus,
    onToggleAgent,
}: {
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onHome: () => void;
    onProjects: () => void;
    onCreateProject: () => void;
    onDeleteProject: () => void;
    onImportImage: () => void;
    onOpenPlugins?: () => void;
    onUndo: () => void;
    onRedo: () => void;
    agentOpen: boolean;
    compactAgentStatus: { connected: boolean; enabled: boolean; activity: string };
    onToggleAgent: () => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const titleRef = useRef<HTMLDivElement>(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    return (
        <>
            <div className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-16 items-center justify-between px-4">
                <div className="pointer-events-auto flex min-w-0 items-center gap-3">
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "home", icon: <Home className="size-4" />, label: "主页", onClick: onHome },
                                { key: "projects", icon: <Images className="size-4" />, label: "我的画布", onClick: onProjects },
                                { type: "divider" },
                                { key: "new", icon: <Plus className="size-4" />, label: "新建画布", onClick: onCreateProject },
                                { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: "删除当前画布", onClick: onDeleteProject },
                                { type: "divider" },
                                { key: "import", icon: <Upload className="size-4" />, label: "导入资产", onClick: onImportImage },
                                { type: "divider" },
                                { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text="撤销" shortcut="⌘ Z" />, onClick: onUndo },
                                { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text="重做" shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
                            ],
                        }}
                    >
                        <button type="button" className="grid size-9 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label="打开画布菜单">
                            <Menu className="size-5" />
                        </button>
                    </Dropdown>

                    <div ref={titleRef} className="flex min-w-0 items-center gap-2">
                        {isTitleEditing ? (
                            <input
                                autoFocus
                                value={titleDraft}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onBlur={onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") onFinishTitleEditing();
                                    if (event.key === "Escape") onCancelTitleEditing();
                                }}
                                className="max-w-[280px] bg-transparent p-0 text-left text-lg font-semibold tracking-normal outline-none"
                                style={{ color: theme.node.text }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="max-w-[280px] truncate border-b border-dashed border-transparent text-left text-lg font-semibold tracking-normal transition hover:border-current"
                                onDoubleClick={onStartTitleEditing}
                                title="双击修改画布名称"
                            >
                                {title}
                            </button>
                        )}
                    </div>
                    {SHOW_AGENT_UI ? <CompactAgentStatus status={compactAgentStatus} onClick={onToggleAgent} /> : null}
                </div>

                <div className="pointer-events-auto flex items-center gap-1.5">
                    <UserStatusActions variant="canvas" onOpenShortcuts={() => setShortcutsOpen(true)} onOpenPlugins={onOpenPlugins} />
                    {SHOW_AGENT_UI ? (
                        <>
                            <span className="h-6 w-px" style={{ background: theme.toolbar.border }} />
                            <Button
                                type="text"
                                className="!h-10 !rounded-xl !px-3 !font-medium"
                                style={{ background: agentOpen ? theme.toolbar.activeBg : theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
                                icon={<Bot className="size-4" />}
                                onClick={onToggleAgent}
                            >
                                Agent
                            </Button>
                        </>
                    ) : null}
                </div>
            </div>
            <Modal title="快捷键" open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut keys={["拖动画布"]} value="平移视图" />
                    <Shortcut keys={["滚轮"]} value="缩放画布" />
                    <Shortcut keys={["缩放滑杆"]} value="精确调整缩放" />
                    <Shortcut keys={["Ctrl / Cmd", "拖动"]} value="框选多个节点" />
                    <Shortcut keys={["Shift / Ctrl / Cmd", "点击"]} value="追加选择节点" />
                    <Shortcut keys={["Ctrl / Cmd", "A"]} value="全选节点" />
                    <Shortcut keys={["Ctrl / Cmd", "C / V"]} value="复制 / 粘贴节点，或粘贴剪切板文本/图片" />
                    <Shortcut keys={["Ctrl / Cmd", "Z"]} value="撤销" />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value="重做" />
                    <Shortcut keys={["Ctrl / Cmd", "Y"]} value="重做" />
                    <Shortcut keys={["Delete / Backspace"]} value="删除选中" />
                    <Shortcut keys={["Esc"]} value="取消选择并关闭浮层" />
                    <Shortcut keys={["拖入图片/视频/音频"]} value="上传到画布" />
                </div>
            </Modal>
        </>
    );
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{text}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}

function CompactAgentStatus({ status, onClick }: { status: { connected: boolean; enabled: boolean; activity: string }; onClick: () => void }) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const label = status.connected ? "Codex 已连接" : status.enabled ? `Codex ${status.activity || "连接中"}` : "Codex 未连接";
    const dotColor = status.connected ? "#22c55e" : status.enabled ? "#f59e0b" : theme.node.muted;
    return (
        <button type="button" className="flex h-8 items-center gap-1.5 text-xs transition hover:opacity-75" style={{ color: status.connected ? "#16a34a" : status.enabled ? "#d97706" : theme.node.muted }} onClick={onClick} title="打开本地 Codex 面板">
            <span className="size-2 rounded-full" style={{ background: dotColor }} />
            <span className="max-w-[140px] truncate">{label}</span>
        </button>
    );
}

function Shortcut({ keys, value }: { keys: string[]; value: string }) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-lg px-1 py-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {keys.map((key, index) => (
                    <span key={`${key}-${index}`} className="flex items-center gap-1.5">
                        {index ? <span className="text-xs opacity-35">+</span> : null}
                        <kbd
                            className="min-w-9 rounded-md border px-2.5 py-1.5 text-center text-xs font-medium leading-none shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]"
                            style={{ borderColor: "rgba(120,113,108,.28)", background: "linear-gradient(#fff, rgba(245,245,244,.92))", color: "rgb(68,64,60)" }}
                        >
                            {key}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-right text-sm opacity-55">{value}</span>
        </div>
    );
}

function imageExtension(value: string) {
    const mime = value.match(/^image\/([^;]+)/)?.[1] || value.match(/^data:image\/([^;]+)/)?.[1] || "png";
    return mime === "jpeg" ? "jpg" : mime;
}

function audioExtension(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("opus")) return "opus";
    if (mimeType?.includes("aac")) return "aac";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("pcm")) return "pcm";
    return "mp3";
}

function imageMetadata(image: UploadedImage): CanvasNodeMetadata {
    return { content: image.url, storageKey: image.storageKey, mediaId: image.mediaId, mediaStatus: image.mediaStatus || (image.mediaId ? "synced" : undefined), status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType };
}

function syncBatchPrimaryNode(root: CanvasNodeData, primary: CanvasNodeData): CanvasNodeData {
    const source = primary.metadata || {};
    return {
        ...root,
        width: primary.width,
        height: primary.height,
        metadata: {
            ...root.metadata,
            primaryImageId: primary.id,
            content: source.content,
            storageKey: source.storageKey,
            mediaId: source.mediaId,
            mediaStatus: source.mediaStatus,
            status: source.status,
            naturalWidth: source.naturalWidth,
            naturalHeight: source.naturalHeight,
            bytes: source.bytes,
            mimeType: source.mimeType,
            freeResize: source.freeResize,
        },
    };
}

function videoMetadata(video: UploadedFile): CanvasNodeMetadata {
    return { content: video.url, storageKey: video.storageKey, mediaId: video.mediaId, mediaStatus: video.mediaStatus || (video.mediaId ? "synced" : undefined), status: "success", naturalWidth: video.width, naturalHeight: video.height, bytes: video.bytes, mimeType: video.mimeType || "video/mp4", durationMs: video.durationMs };
}

function canvasVideoMetadata(video: CanvasVideoStoredResult): CanvasNodeMetadata {
    return {
        content: video.url,
        serverStorageKey: video.storageKey || undefined,
        storageKey: undefined,
        status: "success",
        naturalWidth: video.width,
        naturalHeight: video.height,
        bytes: video.bytes,
        mimeType: video.mimeType || "video/mp4",
        durationMs: video.durationMs,
        videoBillingStatus: video.billingStatus,
        videoRouteLabel: video.routeLabel,
        pricingVersion: video.pricingVersion,
        videoProgress: 100,
    };
}

function canvasVideoTaskMetadata(task: CanvasVideoTask): CanvasNodeMetadata {
    return {
        videoProgress: task.progress,
        videoPhase: task.archiveStatus === "archiving" ? "archiving" : task.status === "queued" ? "queued" : task.status === "submission_unknown" ? "submission_unknown" : "generating",
        videoCanCancel: Boolean(task.canCancel),
        videoQueuePosition: task.queuePosition,
        videoBillingStatus: task.billingStatus,
        videoRouteLabel: task.pricingSnapshot?.routeLabel,
        pricingVersion: task.pricingVersion,
    };
}

function audioMetadata(audio: UploadedFile | StoredGeneratedAudio, sourceType: "upload" | "tts" = "upload"): CanvasNodeMetadata {
    const generated = audio as StoredGeneratedAudio;
    return {
        content: audio.url,
        storageKey: audio.storageKey || undefined,
        mediaId: audio.mediaId,
        mediaStatus: audio.mediaStatus || (audio.mediaId ? "synced" : undefined),
        status: "success",
        bytes: audio.bytes,
        mimeType: audio.mimeType || "audio/mpeg",
        durationMs: audio.durationMs,
        sourceType,
        audioTaskId: generated.taskId,
        audioEngine: generated.engine,
        voiceId: generated.voiceId,
        characterCount: generated.characterCount,
    };
}

function buildImageGenerationMetadata(type: CanvasImageGenerationType, config: AiConfig, count: number, references: ReferenceImage[]): CanvasNodeMetadata {
    return {
        generationType: type,
        model: config.model,
        size: config.size,
        quality: config.quality,
        count,
        references: references.map(referenceUrl).filter((url): url is string => Boolean(url)),
    };
}

function buildAudioGenerationMetadata(config: AiConfig): CanvasNodeMetadata {
    return {
        model: config.model,
        audioVoice: config.audioVoice,
        audioVoiceName: config.audioVoiceName,
        audioFormat: config.audioFormat,
        audioSpeed: config.audioSpeed,
        audioInstructions: config.audioInstructions,
    };
}

function referenceUrl(image: ReferenceImage) {
    return image.storageKey || image.url || (!image.dataUrl.startsWith("data:") ? image.dataUrl : undefined);
}

function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    return [
        ...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)),
        ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url)),
        ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url).filter((url): url is string => Boolean(url)),
    ];
}

function logCanvasVideoReferenceDebug(input: {
    nodeId: string;
    prompt: string;
    referenceOrder: string[];
    references: CanvasResourceReference[];
    generationContext: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ id?: string; storageKey?: string; url?: string }>; referenceAudios: Array<{ id?: string; storageKey?: string; url?: string }> };
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
}) {
    if (typeof window === "undefined" || window.localStorage.getItem("canvas.debug.references") !== "1") return;
    const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
    console.groupCollapsed("[Canvas] video reference order");
    console.log("target", nodeById.get(input.nodeId));
    console.table(input.nodes.filter((node) => input.references.some((reference) => reference.nodeId === node.id)).map((node) => ({
        id: node.id,
        title: node.title,
        kind: node.type,
        storageKey: node.metadata?.storageKey,
        referenceOrder: node.metadata?.referenceOrder?.join(",") || "",
        label: input.references.find((reference) => reference.nodeId === node.id)?.label || "",
    })));
    console.table(input.connections.map((connection, index) => ({ index, id: connection.id, from: connection.fromNodeId, to: connection.toNodeId })));
    console.log("prompt", input.prompt);
    console.log("referenceOrder", input.referenceOrder);
    console.log("uploaded image ids", input.generationContext.referenceImages.map((reference) => reference.id));
    console.log("uploaded video ids", input.generationContext.referenceVideos.map((reference) => reference.id));
    console.log("uploaded audio ids", input.generationContext.referenceAudios.map((reference) => reference.id));
    console.groupEnd();
}

async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(
        metadata.references.map(async (url, index) => {
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, storageKey: url.startsWith("image:") ? url : undefined } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    const hydrated = await Promise.all(
        nodes.map(async (node) => {
            const content = node.metadata?.content;
            if (node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) {
                if (node.metadata?.mediaId) {
                    const remote = await resolveCanvasMediaUrl(node.metadata.mediaId, content || "");
                    return remote ? { ...node, metadata: { ...node.metadata, content: remote, mediaStatus: "synced" as const } } : node;
                }
                if (node.metadata?.storageKey) {
                    const local = await getMediaBlob(node.metadata.storageKey);
                    if (local?.size) {
                        try {
                            const uploaded = await uploadMediaFile(local, node.type === CanvasNodeType.Video ? "video" : "audio");
                            return { ...node, metadata: { ...node.metadata, ...(node.type === CanvasNodeType.Video ? videoMetadata(uploaded) : audioMetadata(uploaded)) } };
                        } catch {
                            // Keep the local preview when the one-time backfill cannot reach the media service.
                        }
                    }
                    return { ...node, metadata: { ...node.metadata, content: await resolveMediaUrl(node.metadata.storageKey, content) } };
                }
                return node;
            }
            if (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.ScriptAsset) return node;
            if (node.metadata?.mediaId) {
                const resolved = await resolvePersistedImageUrl(node.metadata.mediaId, node.metadata.storageKey, content);
                return resolved ? { ...node, metadata: { ...node.metadata, content: resolved } } : node;
            }
            if (node.metadata?.storageKey) {
                const local = await getImageBlob(node.metadata.storageKey);
                if (local?.size) {
                    try {
                        return { ...node, metadata: { ...node.metadata, ...imageMetadata(await uploadImage(local)) } };
                    } catch {
                        // Keep the local preview when the one-time backfill cannot reach the media service.
                    }
                }
                return { ...node, metadata: { ...node.metadata, content: await resolveImageUrl(node.metadata.storageKey, content) } };
            }
            if (!content) return node;
            if (!content.startsWith("data:image/")) return node;
            return { ...node, metadata: { ...node.metadata, ...imageMetadata(await uploadImage(content)) } };
        }),
    );
    const nodeById = new Map(hydrated.map((node) => [node.id, node]));
    return hydrated.map((node) => {
        if (!node.metadata?.isBatchRoot) return node;
        const childIds = (node.metadata.batchChildIds || []).filter((id) => nodeById.has(id));
        const selected = nodeById.get(node.metadata.primaryImageId || "");
        const primary = selected?.metadata?.content ? selected : childIds.map((id) => nodeById.get(id)).find((child) => child?.metadata?.content);
        if (!primary) return { ...node, metadata: { ...node.metadata, batchChildIds: childIds } };
        return syncBatchPrimaryNode({ ...node, metadata: { ...node.metadata, batchChildIds: childIds } }, primary);
    });
}

async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.storageKey) return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        if (item.dataUrl?.startsWith("data:image/")) {
            const image = await uploadImage(item.dataUrl);
            return { ...item, dataUrl: image.url, storageKey: image.storageKey };
        }
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

function getGenerationCount(count: string) {
    return normalizeImageCount(count);
}

function applyNodeConfigPatch(node: CanvasNodeData, patch: Partial<CanvasNodeData["metadata"]>) {
    const safePatch = patch || {};
    const next = { ...node, metadata: { ...node.metadata, ...safePatch } };
    const spec = node.type === CanvasNodeType.Video ? NODE_DEFAULT_SIZE[CanvasNodeType.Video] : NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const size = typeof safePatch.size === "string" && !node.metadata?.content ? nodeSizeFromRatio(safePatch.size, spec.width, spec.height) : null;
    return size && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) ? { ...next, ...size, position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 } } : next;
}

function findGroupDropTarget(movedIds: Set<string>, nodes: CanvasNodeData[]) {
    if (nodes.some((node) => movedIds.has(node.id) && node.type === CanvasNodeType.Group)) return null;
    const movingNodes = nodes.filter((node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group);
    if (!movingNodes.length) return null;
    return (
        [...nodes].reverse().find((group) => {
                if (group.type !== CanvasNodeType.Group || movedIds.has(group.id)) return false;
                return movingNodes.some((node) => {
                    const centerX = node.position.x + node.width / 2;
                    const centerY = node.position.y + node.height / 2;
                    return centerX >= group.position.x && centerX <= group.position.x + group.width && centerY >= group.position.y && centerY <= group.position.y + group.height;
                });
            }) || null
    );
}

function findGroupDropTargetDuringDrag(drag: NodeDragState, nodes: CanvasNodeData[]) {
    if (nodes.some((node) => drag.movedIds.has(node.id) && node.type === CanvasNodeType.Group)) return null;
    const movingNodes = drag.initialSelectedNodes
        .map((initial) => {
            const node = drag.nodeById.get(initial.id);
            return node && node.type !== CanvasNodeType.Group ? { ...node, position: { x: initial.x + drag.previewDx, y: initial.y + drag.previewDy } } : null;
        })
        .filter((node): node is CanvasNodeData => Boolean(node));
    if (!movingNodes.length) return null;
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const group = nodes[index];
        if (group.type !== CanvasNodeType.Group || drag.movedIds.has(group.id)) continue;
        if (
            movingNodes.some((node) => {
                const centerX = node.position.x + node.width / 2;
                const centerY = node.position.y + node.height / 2;
                return centerX >= group.position.x && centerX <= group.position.x + group.width && centerY >= group.position.y && centerY <= group.position.y + group.height;
            })
        )
            return group;
    }
    return null;
}

function applyNodeDragPreview(drag: NodeDragState, dx: number, dy: number) {
    const initialById = drag.initialById;
    drag.nodeElements.forEach((element, id) => {
        const initial = initialById.get(id);
        if (initial) element.style.transform = `translate(${initial.x + dx}px, ${initial.y + dy}px)`;
    });

    if (!drag.connectionElements.length) return;
    drag.connectionElements.forEach(({ connection, paths }) => {
        const from = drag.nodeById.get(connection.fromNodeId);
        const to = drag.nodeById.get(connection.toNodeId);
        if (!from || !to) return;
        const fromInitial = initialById.get(from.id);
        const toInitial = initialById.get(to.id);
        const previewFrom = fromInitial ? { ...from, position: { x: fromInitial.x + dx, y: fromInitial.y + dy } } : from;
        const previewTo = toInitial ? { ...to, position: { x: toInitial.x + dx, y: toInitial.y + dy } } : to;
        const path = connectionPath(previewFrom, previewTo);
        paths.forEach((element) => element.setAttribute("d", path));
    });
}

function connectionPath(from: CanvasNodeData, to: CanvasNodeData) {
    const startX = from.position.x + from.width;
    const startY = from.position.y + from.height / 2;
    const endX = to.position.x;
    const endY = to.position.y + to.height / 2;
    const curvature = Math.max(Math.abs(endX - startX) * 0.5, 50);
    return `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;
}

function snapNodesIntoGroup(movedIds: Set<string>, nodes: CanvasNodeData[], group: CanvasNodeData) {
    const movingNodes = nodes.filter((node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group);
    if (!movingNodes.length) return nodes;
    const pad = 24;
    const bounds = nodeBounds(movingNodes);
    const left = group.position.x + pad;
    const top = group.position.y + pad;
    const right = group.position.x + group.width - pad;
    const bottom = group.position.y + group.height - pad;
    const dx = bounds.right - bounds.left > right - left ? left - bounds.left : bounds.left < left ? left - bounds.left : bounds.right > right ? right - bounds.right : 0;
    const dy = bounds.bottom - bounds.top > bottom - top ? top - bounds.top : bounds.top < top ? top - bounds.top : bounds.bottom > bottom ? bottom - bounds.bottom : 0;
    return nodes.map((node) => {
        if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group) return node;
        return { ...node, position: { x: node.position.x + dx, y: node.position.y + dy }, metadata: { ...node.metadata, groupId: group.id } };
    });
}

function nodeBounds(nodes: CanvasNodeData[]) {
    return nodes.reduce(
        (acc, node) => ({
            left: Math.min(acc.left, node.position.x),
            top: Math.min(acc.top, node.position.y),
            right: Math.max(acc.right, node.position.x + node.width),
            bottom: Math.max(acc.bottom, node.position.y + node.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
}

function findContainingGroupId(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    const centerX = node.position.x + node.width / 2;
    const centerY = node.position.y + node.height / 2;
    return (
        [...nodes]
            .reverse()
            .find((group) => group.type === CanvasNodeType.Group && group.id !== node.id && centerX >= group.position.x && centerX <= group.position.x + group.width && centerY >= group.position.y && centerY <= group.position.y + group.height)?.id ||
        undefined
    );
}

function getConnectionTargetAnchor(node: CanvasNodeData, current: ConnectionHandle) {
    return {
        x: current.handleType === "source" ? node.position.x : node.position.x + node.width,
        y: node.position.y + node.height / 2,
    };
}

function normalizeConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNodeData[], firstHandleType: "source" | "target") {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    if (!first || !second || first.id === second.id) return null;
    if (first.type === CanvasNodeType.Group || second.type === CanvasNodeType.Group) return null;
    return firstHandleType === "target" ? { fromNodeId: second.id, toNodeId: first.id } : { fromNodeId: first.id, toNodeId: second.id };
}

function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? config.imageModel : mode === "video" ? config.videoModel : mode === "audio" ? config.audioModel : config.textModel;
    return {
        ...config,
        model: node?.metadata?.model || defaultModel || (mode === "audio" ? defaultConfig.audioModel : config.model || defaultConfig.model),
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: node?.metadata?.size || config.size || defaultConfig.size,
        videoSeconds: node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        videoMode: node?.metadata?.videoMode || config.videoMode || defaultConfig.videoMode,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
}

function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) => {
        if (node.metadata?.status !== "loading") return node;
        if (node.type === CanvasNodeType.Audio && node.metadata.sourceType === "tts" && node.metadata.audioTaskId) return node;
        if (node.type === CanvasNodeType.Video && node.metadata.videoTaskId) return node;
        return { ...node, metadata: { ...node.metadata, status: "error" as const, errorDetails: "页面刷新后生成已中断，请重新生成。" } };
    });
}

function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === "请求已取消" || error.name === "AbortError");
}

function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content,
            storageKey: node.metadata.storageKey,
        },
    ];
}

function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name);
}

function isHiddenBatchChild(node: CanvasNodeData, nodes: CanvasNodeData[] | ReadonlyMap<string, CanvasNodeData>, collapsingBatchIds?: Set<string>) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = Array.isArray(nodes) ? nodes.find((item) => item.id === rootId) : nodes.get(rootId);
    if (root && collapsingBatchIds?.has(rootId)) return false;
    return Boolean(root && !root.metadata?.imageBatchExpanded);
}

function isHiddenBatchConnectionEndpoint(node: CanvasNodeData, nodes: CanvasNodeData[] | ReadonlyMap<string, CanvasNodeData>) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = Array.isArray(nodes) ? nodes.find((item) => item.id === rootId) : nodes.get(rootId);
    return Boolean(root && !root.metadata?.imageBatchExpanded);
}

function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? "正面视角" : params.horizontalAngle > 0 ? `向右旋转 ${params.horizontalAngle} 度` : `向左旋转 ${Math.abs(params.horizontalAngle)} 度`;
    const pitch = params.pitchAngle === 0 ? "水平视角" : params.pitchAngle > 0 ? `俯视 ${params.pitchAngle} 度` : `仰视 ${Math.abs(params.pitchAngle)} 度`;
    return `AI 多角度：${horizontal}，${pitch}，镜头距离 ${params.cameraDistance.toFixed(1)}，${params.wideAngle ? "广角" : "标准"}镜头`;
}

function buildAnglePrompt(params: CanvasImageAngleParams) {
    return `基于参考图重新生成同一主体的新视角，保持主体、颜色、材质和画面风格一致，不要只做透视变形。${buildAngleLabel(params)}。`;
}
