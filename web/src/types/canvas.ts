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
    AssetExtraction = "asset-extraction",
    ScriptAsset = "script-asset",
    AssetStoryboard = "asset-storyboard",
}

// 节点类型放开为字符串,内置类型用 CanvasNodeType,插件类型为 "<pluginId>:<name>"
export type CanvasNodeTypeId = CanvasNodeType | (string & {});

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";
export type CanvasTextOperation = "continue" | "polish" | "expand" | "shorten" | "summarize" | "translate" | "custom";

export type AssetStoryboardShot = {
    id: string;
    index: number;
    durationSec: number;
    title: string;
    sourceExcerpt: string;
    storyPurpose: string;
    visualDescription: string;
    shotSize: string;
    lighting: string;
    dialogue: string;
    sound: string;
    cameraMovement: string;
    characters: string[];
    assetIds: string[];
    previousHandoff: string;
    startState: string;
    endState: string;
    continuity: string;
    negativeConstraints: string[];
    finalPrompt?: string;
    promptStatus: "idle" | "generating" | "success" | "error";
    promptError?: string;
    locked?: boolean;
};

export type AssetStoryboardState = {
    version: 1;
    sourceNodeId: string;
    contentHash: string;
    status: "queued" | "analyzing" | "ready" | "error";
    errorDetails?: string;
    title: string;
    totalDurationSec: number;
    continuityBible: string;
    shots: AssetStoryboardShot[];
};

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
    groupColor?: string;
    scriptSetId?: string;
    scriptSetNodeId?: string;
    scriptSetExpanded?: boolean;
    scriptAssetId?: string;
    scriptVariantId?: string;
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
    assetExtractionContentHash?: string;
    assetExtractionStoryboardNodeId?: string;
    assetExtractionVideoDraftNodeId?: string;
    assetExtractionStoryboardSourceId?: string;
    assetExtractionVideoDraftSourceId?: string;
    assetStoryboard?: AssetStoryboardState;
    assetStoryboardSourceId?: string;
    assetStoryboardShotId?: string;
    assetStoryboardShotIndex?: number;
    scriptAssetType?: "character" | "scene" | "prop";
    scriptAssetVisualDescription?: string;
    scriptAssetImagePrompt?: string;
    scriptAssetImageStatus?: string;
    scriptAssetStale?: boolean;
    sourceScriptAssetId?: string;
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
