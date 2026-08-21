export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Video = "video",
    Audio = "audio",
    Group = "group",
    ScriptSet = "script-set",
    AssetExtraction = "asset-extraction",
    ScriptAsset = "script-asset",
    Storyboard = "storyboard",
}

// 节点类型放开为字符串,内置类型用 CanvasNodeType,插件类型为 "<pluginId>:<name>"
export type CanvasNodeTypeId = CanvasNodeType | (string & {});

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";
export type CanvasTextOperation = "continue" | "polish" | "expand" | "shorten" | "summarize" | "translate" | "custom";

export type CanvasNodeMetadata = {
    content?: string;
    composerContent?: string;
    prompt?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    size?: string;
    quality?: string;
    count?: number;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    videoMode?: string;
    videoParameters?: Record<string, unknown>;
    videoTaskId?: string;
    videoProvider?: "canvas-video";
    serverStorageKey?: string;
    videoProgress?: number;
    videoPhase?: "queued" | "generating" | "archiving";
    videoCanCancel?: boolean;
    videoQueuePosition?: number | null;
    estimatedCostCredits?: number;
    chargedCredits?: number;
    videoBalanceAfter?: number;
    videoBillingStatus?: string;
    videoRouteLabel?: string;
    pricingVersion?: number;
    audioVoice?: string;
    audioVoiceName?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    isBatchRoot?: boolean;
    batchRootId?: string;
    batchChildIds?: string[];
    batchUsesReferenceImages?: boolean;
    primaryImageId?: string;
    imageBatchExpanded?: boolean;
    storageKey?: string;
    mediaId?: string;
    mediaStatus?: "uploading" | "synced" | "missing" | "failed";
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    sourceType?: "upload" | "tts";
    audioTaskId?: string;
    audioEngine?: "speech" | "voxcpm2";
    voiceId?: number;
    characterCount?: number;
    groupId?: string;
    scriptSetId?: string;
    scriptSetNodeId?: string;
    scriptSetExpanded?: boolean;
    scriptAssetId?: string;
    scriptVariantId?: string;
    storyboardId?: string;
    storyboardNodeId?: string;
    scriptAssetImageId?: string;
    scriptAssetImageBatchId?: string;
    scriptAssetImageTaskId?: string;
    scriptAssetGroupType?: "character" | "scene" | "prop";
    assetExtractionNodeId?: string;
    assetExtractionEpisodeId?: string;
    assetExtractionRunId?: string;
    assetExtractionStatus?: "idle" | "analyzing" | "success" | "error";
    assetExtractionVisualStyle?: string;
    assetExtractionTextModel?: string;
    assetExtractionImageModel?: string;
    assetExtractionAspectRatio?: string;
    assetExtractionImageQuality?: string;
    assetExtractionAssetCount?: number;
    assetExtractionPendingCount?: number;
    assetExtractionImageBatchIds?: string[];
    assetExtractionUpdatedAt?: number;
    scriptAssetType?: "character" | "scene" | "prop";
    scriptAssetVisualDescription?: string;
    scriptAssetImagePrompt?: string;
    scriptAssetImageStatus?: string;
    scriptAssetStale?: boolean;
    sourceNodeId?: string;
    sourceOperation?: CanvasTextOperation;
    sourceScope?: "full" | "selection";
    generationRequestId?: string;
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
