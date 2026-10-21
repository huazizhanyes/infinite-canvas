import { nanoid } from "nanoid";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { serializeCanvasResourceMention } from "@/lib/canvas/canvas-resource-references";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export type ClipStoryboardAssetKind = "image" | "audio";

export type ClipStoryboardAssetEntry = {
    name: string;
    kind: ClipStoryboardAssetKind;
};

/** Global asset table entry: asset name, its @aliases used by clips, and the appearance description. */
export type ClipStoryboardAssetAlias = {
    assetName: string;
    aliases: string[];
    description: string;
};

export type ClipStoryboardClip = {
    code: string;
    title?: string;
    durationSec: number;
    body: string;
    assets: ClipStoryboardAssetEntry[];
};

export type ClipStoryboardParseResult = {
    clips: ClipStoryboardClip[];
    assetTable: ClipStoryboardAssetAlias[];
    voiceNames: string[];
    globalRules: string;
    error?: string;
};

export type ClipStoryboardUnmatched = {
    name: string;
    kind: ClipStoryboardAssetKind;
};

export type ClipStoryboardAssetMatch = {
    name: string;
    kind: ClipStoryboardAssetKind;
    nodeId: string;
    nodeTitle: string;
};

export type ClipStoryboardFuzzyMatch = ClipStoryboardAssetMatch;
export type ClipStoryboardAliasMatch = ClipStoryboardAssetMatch;

export type ClipStoryboardClipMatch = {
    clip: ClipStoryboardClip;
    images: CanvasNodeData[];
    audios: CanvasNodeData[];
    unmatched: ClipStoryboardUnmatched[];
    fuzzy: ClipStoryboardFuzzyMatch[];
    aliases: ClipStoryboardAliasMatch[];
    warnings: string[];
    prompt: string;
};

export type ClipStoryboardMatchOptions = {
    durationOptions?: number[];
    assetTable?: ClipStoryboardAssetAlias[];
    voiceNames?: string[];
    globalRules?: string;
};

export const CLIP_STORYBOARD_MAX_IMAGES = 9;
export const CLIP_STORYBOARD_MAX_AUDIOS = 3;
export const CLIP_STORYBOARD_MAX_AUDIO_MS = 15_000;

const CLIP_HEADER = /^\s*(?:>\s*|[-*+]\s+)?(?:#{1,6}\s*)?(?:【\s*)?(?:\*\*|__)?\s*clip\s*[：:]?\s*([A-Za-z]{0,4}\d{1,3}(?:\s*[-–—]\s*\d{1,3})*[A-Za-z]?)\s*[|｜]\s*(?:([^|｜\n]*?)\s*[|｜]\s*)?(?:约|大约|约莫|≈|~|～)?\s*(\d+(?:\.\d+)?)\s*(?:s|sec|seconds|秒)\s*(?:\*\*|__)?\s*(?:】)?\s*[：:]?\s*$/i;
const SECTION_TITLE_LINE = /^#{1,2}(?!#)\s*(.+)$/;
const GLOBAL_SECTION_HEADING = /^#{1,6}\s*(全局规则|资产全局映射表|声音参考锁定)\s*$/;
const ANY_HEADING = /^#{1,6}\s+/;
const CODE_FENCE = /^\s*```[\w-]*\s*$/;
const SECTION_START = /^【/;
const SECTION_VOICE = /^【\s*声音参考锁定/;
const ASSET_LINE = /^\s*([^→\n]+?)\s*(?:→|->|⟶)\s*@\s*(?:→\s*)?(.*)$/;
const INLINE_ASSET_LINE = /^\s*(?:\*\*)?资产(?:\*\*)?\s*[：:]\s*(.*)$/;
const INLINE_ASSET_TOKEN = /@([^@、,，。；;\s]+)/g;

export function parseClipStoryboardScript(script: string): ClipStoryboardParseResult {
    const lines = String(script || "").replace(/\r\n?/g, "\n").split("\n");
    const sections = parseGlobalSections(lines);
    const headers: Array<{ code: string; title?: string; durationSec: number; lineIndex: number }> = [];
    let sectionCode = "";
    lines.forEach((line, lineIndex) => {
        const match = line.match(CLIP_HEADER);
        if (match) {
            const title = match[2]?.replace(/[*_]/g, "").trim();
            headers.push({ code: combineClipCode(sectionCode, normalizeClipCode(match[1])), ...(title ? { title } : {}), durationSec: Number(match[3]), lineIndex });
            return;
        }
        const sectionTitle = line.match(SECTION_TITLE_LINE);
        if (sectionTitle) sectionCode = sectionCodeOf(sectionTitle[1]);
    });
    if (!headers.length) return { ...sections, clips: [], error: "未识别到 Clip 头，支持 **Clip S01-01｜12s**、### Clip S12-02｜标题｜约5秒，或 ## S01 + ### Clip 01｜标题｜12秒" };
    return {
        ...sections,
        clips: headers.map((header, index) => {
            const bodyStart = header.lineIndex + 1;
            const bodyEnd = index + 1 < headers.length ? headers[index + 1].lineIndex : lines.length;
            const body = trimClipBody(lines.slice(bodyStart, bodyEnd));
            const assets = [...parseClipAssetEntries(body), ...parseInlineClipAssets(body)];
            return { code: header.code, ...(header.title ? { title: header.title } : {}), durationSec: header.durationSec, body, assets };
        }),
    };
}

/** Bare clip numbers inherit the `## S01 …` section code so multiple sections do not collide. */
function sectionCodeOf(title: string) {
    const match = String(title || "").match(/^([A-Za-z]{0,3}\d{1,3})(?!\d)/);
    return match ? normalizeClipCode(match[1]) : "";
}

function combineClipCode(sectionCode: string, rawCode: string) {
    if (!sectionCode) return rawCode;
    if (/^[A-Z]{1,3}\d/.test(rawCode)) return rawCode;
    return `${sectionCode}-${rawCode}`;
}

function parseGlobalSections(lines: string[]) {
    let section: "rules" | "assets" | "voice" | null = null;
    const ruleLines: string[] = [];
    const assetLines: string[] = [];
    const voiceLines: string[] = [];
    lines.forEach((line) => {
        const heading = line.match(GLOBAL_SECTION_HEADING);
        if (heading) {
            section = heading[1] === "全局规则" ? "rules" : heading[1] === "资产全局映射表" ? "assets" : "voice";
            return;
        }
        if (ANY_HEADING.test(line)) {
            section = null;
            return;
        }
        if (section === "rules") ruleLines.push(line);
        if (section === "assets") assetLines.push(line);
        if (section === "voice") voiceLines.push(line);
    });
    return {
        globalRules: ruleLines.join("\n").replace(/\*\*/g, "").replace(/\n{3,}/g, "\n\n").trim(),
        assetTable: parseAssetTableLines(assetLines),
        voiceNames: parseVoiceNames(voiceLines),
    };
}

function parseAssetTableLines(lines: string[]) {
    return lines.flatMap((line): ClipStoryboardAssetAlias[] => {
        const cleaned = line.replace(/^\s*[-*+]\s*/, "").trim();
        if (!cleaned) return [];
        const parts = cleaned.split(/\s*(?:→|->|⟶)\s*/);
        if (parts.length < 2) return [];
        const assetName = parts[0].trim();
        const aliases = parts[1].split(/[、,，;；]/).map((item) => item.trim().replace(/^@/, "")).filter(Boolean);
        const description = parts.slice(2).join(" → ").trim();
        return assetName && aliases.length ? [{ assetName, aliases, description }] : [];
    });
}

function parseVoiceNames(lines: string[]) {
    const names = new Set<string>();
    lines.join("\n").split(/[；;。\n]/).forEach((segment) => {
        const match = segment.match(/^\s*([^→\n]+?)\s*(?:→|->|⟶)\s*@/);
        if (match) names.add(match[1].trim());
    });
    return [...names];
}

function parseInlineClipAssets(body: string) {
    const entries: ClipStoryboardAssetEntry[] = [];
    for (const line of body.split("\n")) {
        const match = line.match(INLINE_ASSET_LINE);
        if (!match) continue;
        for (const token of match[1].matchAll(INLINE_ASSET_TOKEN)) {
            const name = token[1].trim();
            if (name) entries.push({ name, kind: "image" });
        }
    }
    return entries;
}

export function normalizeClipCode(value: string) {
    return String(value || "").replace(/\s+/g, "").replace(/[–—]/g, "-").toUpperCase();
}

/** Normalize asset names for exact and fuzzy matching (extensions, brackets, punctuation, spacing and case). */
export function normalizeClipAssetName(value: string) {
    return String(value || "")
        .replace(/\.(png|jpe?g|webp|gif|bmp|avif|mp3|wav|m4a|aac|ogg|flac)$/i, "")
        .replace(/[\[\]【】()（）「」『』《》<>\/／*#_'"`·•・、，,。.．\-–—_\s]/g, "")
        .toLowerCase();
}

export function clipStoryboardAssetKind(node: CanvasNodeData): ClipStoryboardAssetKind | null {
    if (!node.metadata?.content && !node.metadata?.mediaId && !node.metadata?.storageKey) return null;
    if (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.ScriptAsset) return "image";
    if (node.type === CanvasNodeType.Audio) return "audio";
    return null;
}

export function getClipStoryboardAssetPool(storyboard: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const connected = connections
        .filter((connection) => connection.toNodeId === storyboard.id)
        .map((connection) => nodeById.get(connection.fromNodeId))
        .filter((node): node is CanvasNodeData => Boolean(node && clipStoryboardAssetKind(node)))
        .filter((node, index, all) => all.findIndex((item) => item.id === node.id) === index);
    const order = storyboard.metadata?.referenceOrder?.length ? storyboard.metadata.referenceOrder : storyboard.metadata?.references || [];
    if (!order.length) return connected;
    const rank = new Map(order.map((id, index) => [id, index]));
    return [...connected].sort((left, right) => (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER));
}

export function matchClipStoryboardClips(clips: ClipStoryboardClip[], pool: CanvasNodeData[], options: ClipStoryboardMatchOptions = {}): ClipStoryboardClipMatch[] {
    const imagePool = pool.filter((node) => clipStoryboardAssetKind(node) === "image");
    const audioPool = pool.filter((node) => clipStoryboardAssetKind(node) === "audio");
    const assetTable = options.assetTable || [];
    const voiceNames = options.voiceNames || [];
    return clips.map((clip) => {
        const images: CanvasNodeData[] = [];
        const audios: CanvasNodeData[] = [];
        const unmatched: ClipStoryboardUnmatched[] = [];
        const unmatchedKeys = new Set<string>();
        const fuzzyBindings = new Map<string, ClipStoryboardAssetMatch>();
        const aliasBindings = new Map<string, ClipStoryboardAssetMatch>();
        const warnings: string[] = [];
        const bindings = new Map<string, CanvasNodeData>();

        const record = (target: Map<string, ClipStoryboardAssetMatch>, key: string, name: string, kind: ClipStoryboardAssetKind, node: CanvasNodeData) => {
            target.set(key, { name, kind, nodeId: node.id, nodeTitle: node.title || node.id });
        };

        const addAudio = (node: CanvasNodeData, name: string, via: "exact" | "alias" | "fuzzy") => {
            if (audios.some((item) => item.id === node.id)) return true;
            if (audios.length >= CLIP_STORYBOARD_MAX_AUDIOS) {
                warnings.push(`每个分镜最多 ${CLIP_STORYBOARD_MAX_AUDIOS} 段声音参考，已忽略「${name}」`);
                return false;
            }
            const durationMs = Number(node.metadata?.durationMs) || 0;
            const totalMs = audios.reduce((sum, item) => sum + (Number(item.metadata?.durationMs) || 0), 0);
            if (durationMs > CLIP_STORYBOARD_MAX_AUDIO_MS) {
                warnings.push(`「${name}」超过 15 秒，已忽略声音参考`);
                return false;
            }
            if (durationMs && totalMs + durationMs > CLIP_STORYBOARD_MAX_AUDIO_MS) {
                warnings.push(`声音参考总时长超过 15 秒，已忽略「${name}」`);
                return false;
            }
            audios.push(node);
            const key = `audio:${normalizeClipAssetName(name)}`;
            if (via === "fuzzy") record(fuzzyBindings, key, name, "audio", node);
            if (via === "alias") record(aliasBindings, key, name, "audio", node);
            return true;
        };

        for (const entry of clip.assets) {
            const key = `${entry.kind}:${normalizeClipAssetName(entry.name)}`;
            if (bindings.has(key)) continue;
            if (entry.kind === "image") {
                const resolution = resolveClipAsset(entry.name, imagePool, assetTable);
                if (!resolution) {
                    if (!unmatchedKeys.has(key)) {
                        unmatchedKeys.add(key);
                        unmatched.push({ name: entry.name, kind: entry.kind });
                    }
                    continue;
                }
                if (!images.some((node) => node.id === resolution.node.id)) {
                    if (images.length >= CLIP_STORYBOARD_MAX_IMAGES) {
                        warnings.push(`每个分镜最多 ${CLIP_STORYBOARD_MAX_IMAGES} 张参考图，已忽略「${entry.name}」`);
                        continue;
                    }
                    images.push(resolution.node);
                }
                bindings.set(key, resolution.node);
                if (resolution.via === "fuzzy") record(fuzzyBindings, key, entry.name, entry.kind, resolution.node);
                if (resolution.via === "alias") record(aliasBindings, key, entry.name, entry.kind, resolution.node);
                continue;
            }
            const audioMatch = findClipAsset(entry.name, audioPool);
            if (!audioMatch) {
                if (!unmatchedKeys.has(key)) {
                    unmatchedKeys.add(key);
                    unmatched.push({ name: entry.name, kind: entry.kind });
                }
                continue;
            }
            if (addAudio(audioMatch.node, entry.name, audioMatch.fuzzy ? "fuzzy" : "exact")) bindings.set(key, audioMatch.node);
        }

        // 新格式：全局声音表里的角色名出现在本 Clip 资产里时，把同名音频节点作为参考音频。
        if (voiceNames.length) {
            for (const entry of clip.assets) {
                if (entry.kind !== "image") continue;
                const voice = findVoiceName(entry.name, voiceNames);
                if (!voice) continue;
                const audioMatch = findClipAsset(voice, audioPool);
                if (audioMatch) addAudio(audioMatch.node, voice, audioMatch.fuzzy ? "fuzzy" : "exact");
            }
        }

        // Seedance 不允许只有参考音频没有参考图/视频，没有图片时声音引用不生效。
        if (audios.length && !images.length) {
            warnings.push("该分镜没有匹配到图片，声音参考未绑定");
            for (const [key, node] of bindings) {
                if (audios.some((audio) => audio.id === node.id)) bindings.delete(key);
            }
            audios.length = 0;
        }
        const kept = (item: ClipStoryboardAssetMatch) => images.some((node) => node.id === item.nodeId) || audios.some((node) => node.id === item.nodeId);
        const fuzzy = [...fuzzyBindings.values()].filter(kept);
        const aliases = [...aliasBindings.values()].filter(kept);
        if (options.durationOptions?.length && !options.durationOptions.includes(clip.durationSec)) {
            warnings.push(`当前模型时长不含 ${clip.durationSec} 秒，生成时会被调整`);
        }
        const body = bindClipStoryboardBody(clip.body, bindings);
        const prompt = options.globalRules && !clip.body.includes("【全局规则】")
            ? `【全局规则】\n${options.globalRules}\n\n${body}`
            : body;
        return { clip, images, audios, unmatched, fuzzy, aliases, warnings, prompt };
    });
}

export function bindClipStoryboardBody(body: string, bindings: ReadonlyMap<string, CanvasNodeData>) {
    let section: ClipStoryboardAssetKind | null = null;
    return body
        .split("\n")
        .map((line) => {
            const trimmed = line.trim();
            if (SECTION_START.test(trimmed)) {
                section = SECTION_VOICE.test(trimmed) ? "audio" : "image";
                return line;
            }
            if (INLINE_ASSET_LINE.test(line)) {
                return line.replace(INLINE_ASSET_TOKEN, (token, alias) => {
                    const node = bindings.get(`image:${normalizeClipAssetName(String(alias))}`);
                    return node ? clipAssetMention(node, String(alias)) : token;
                });
            }
            const activeSection = section;
            if (!activeSection) return line;
            const match = line.match(ASSET_LINE);
            if (!match) return line;
            const name = match[1].trim();
            const node = bindings.get(`${activeSection}:${normalizeClipAssetName(name)}`);
            if (!node) return line;
            const tail = match[2].trim().replace(/^→\s*/, "").trim();
            const description = tail === "待绑定" ? "" : tail;
            return `${name} → ${clipAssetMention(node, name)}${description ? ` → ${description}` : ""}`;
        })
        .join("\n");
}

export function buildClipStoryboardOps(input: {
    storyboard: CanvasNodeData;
    matches: ClipStoryboardClipMatch[];
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    videoModel?: string;
}): CanvasAgentOp[] {
    const { storyboard, matches, nodes, connections, videoModel } = input;
    const ops: CanvasAgentOp[] = [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const existing = nodes.filter((node) => node.type === CanvasNodeType.Video && node.metadata?.clipStoryboardSourceId === storyboard.id);
    const existingByCode = new Map<string, CanvasNodeData[]>();
    existing.forEach((node) => {
        const code = String(node.metadata?.clipStoryboardClipCode || "");
        if (!code) return;
        const list = existingByCode.get(code) || [];
        list.push(node);
        existingByCode.set(code, list);
    });
    const codeCursor = new Map<string, number>();
    const reused = new Set<string>();
    const selected: string[] = [];
    matches.forEach((entry, index) => {
        const { clip, images, audios, prompt } = entry;
        const cursor = codeCursor.get(clip.code) || 0;
        codeCursor.set(clip.code, cursor + 1);
        const old = existingByCode.get(clip.code)?.[cursor];
        const id = old?.id || nanoid();
        if (old) reused.add(old.id);
        selected.push(id);
        const referenceOrder = [...images.map((node) => node.id), ...audios.map((node) => node.id)];
        const metadata = {
            prompt,
            composerContent: prompt,
            seconds: String(clip.durationSec),
            model: videoModel,
            sourceNodeId: storyboard.id,
            clipStoryboardSourceId: storyboard.id,
            clipStoryboardClipCode: clip.code,
            clipStoryboardClipTitle: clip.title,
            clipStoryboardClipIndex: index,
            references: referenceOrder,
            referenceOrder,
            ...(old?.metadata?.content || old?.metadata?.videoTaskId ? {} : { status: "idle" as const, errorDetails: undefined }),
        };
        const title = `${clip.code}${clip.title ? ` · ${clip.title}` : ""} · ${clip.durationSec}s`;
        if (old) {
            ops.push({ type: "update_node", id, patch: { title }, metadata });
        } else {
            ops.push({
                type: "add_node",
                id,
                nodeType: CanvasNodeType.Video,
                title,
                position: { x: storyboard.position.x + storyboard.width + 120 + (index % 3) * 500, y: storyboard.position.y + Math.floor(index / 3) * 300 },
                width: 420,
                height: 236,
                metadata,
            });
        }
        if (!connections.some((connection) => connection.fromNodeId === storyboard.id && connection.toNodeId === id)) {
            ops.push({ type: "connect_nodes", id: nanoid(), fromNodeId: storyboard.id, toNodeId: id });
        }
        [...images, ...audios].forEach((asset) => {
            if (!connections.some((connection) => connection.fromNodeId === asset.id && connection.toNodeId === id)) {
                ops.push({ type: "connect_nodes", id: nanoid(), fromNodeId: asset.id, toNodeId: id });
            }
        });
        // 音频连线会被视频节点无条件带入生成，重拆后必须清掉不再匹配的声音参考。
        connections
            .filter((connection) => connection.toNodeId === id && !referenceOrder.includes(connection.fromNodeId) && nodeById.get(connection.fromNodeId)?.type === CanvasNodeType.Audio)
            .forEach((connection) => ops.push({ type: "delete_connections", id: connection.id }));
    });
    existing.forEach((node) => {
        if (reused.has(node.id)) return;
        if (node.metadata?.content || node.metadata?.videoTaskId) return;
        ops.push({ type: "delete_node", id: node.id });
    });
    ops.push({ type: "select_nodes", ids: selected });
    return ops;
}

function trimClipBody(lines: string[]) {
    let start = 0;
    let end = lines.length;
    while (start < end && (!lines[start].trim() || CODE_FENCE.test(lines[start]))) start += 1;
    while (end > start && (!lines[end - 1].trim() || CODE_FENCE.test(lines[end - 1]))) end -= 1;
    return lines.slice(start, end).join("\n");
}

function parseClipAssetEntries(body: string) {
    const entries: ClipStoryboardAssetEntry[] = [];
    let section: ClipStoryboardAssetKind | null = null;
    for (const line of body.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (SECTION_START.test(trimmed)) {
            section = SECTION_VOICE.test(trimmed) ? "audio" : "image";
            continue;
        }
        const activeSection = section;
        if (!activeSection) continue;
        const match = trimmed.match(ASSET_LINE);
        const name = match?.[1]?.trim();
        if (name) entries.push({ name, kind: activeSection });
    }
    return entries;
}

function resolveClipAsset(name: string, pool: CanvasNodeData[], assetTable: ClipStoryboardAssetAlias[]): { node: CanvasNodeData; via: "exact" | "alias" | "fuzzy" } | null {
    const exact = findExactClipAsset(name, pool);
    if (exact) return { node: exact, via: "exact" };
    const tableEntry = findAssetTableEntry(name, assetTable);
    if (tableEntry) {
        const byAssetName = findClipAsset(tableEntry.assetName, pool);
        if (byAssetName) return { node: byAssetName.node, via: "alias" };
    }
    const fuzzy = findFuzzyClipAsset(name, pool);
    return fuzzy ? { node: fuzzy, via: "fuzzy" } : null;
}

/** 全局资产表：别名（可多个）→ 资产名；别名对不上时再做一次包含匹配（如 道观院内小径 → 院内小径）。 */
function findAssetTableEntry(name: string, assetTable: ClipStoryboardAssetAlias[]) {
    const target = normalizeClipAssetName(name);
    if (!target) return null;
    const byAlias = assetTable.find((entry) => entry.aliases.some((alias) => normalizeClipAssetName(alias) === target));
    if (byAlias) return byAlias;
    const byAssetName = assetTable.find((entry) => normalizeClipAssetName(entry.assetName) === target);
    if (byAssetName) return byAssetName;
    return assetTable.find((entry) => entry.aliases.some((alias) => {
        const value = normalizeClipAssetName(alias);
        return Boolean(value) && (value.includes(target) || target.includes(value));
    })) || null;
}

function findVoiceName(alias: string, voiceNames: string[]) {
    const target = normalizeClipAssetName(alias);
    if (!target) return null;
    return voiceNames.find((voice) => normalizeClipAssetName(voice) === target) || null;
}

function findExactClipAsset(name: string, pool: CanvasNodeData[]) {
    const target = normalizeClipAssetName(name);
    if (!target) return null;
    return pool.find((node) => normalizeClipAssetName(node.title || "") === target) || null;
}

function findFuzzyClipAsset(name: string, pool: CanvasNodeData[]) {
    const target = normalizeClipAssetName(name);
    if (!target) return null;
    return pool.find((node) => {
        const title = normalizeClipAssetName(node.title || "");
        return Boolean(title) && (title.includes(target) || target.includes(title));
    }) || null;
}

function findClipAsset(name: string, pool: CanvasNodeData[]): { node: CanvasNodeData; fuzzy: boolean } | null {
    const exact = findExactClipAsset(name, pool);
    if (exact) return { node: exact, fuzzy: false };
    const fuzzy = findFuzzyClipAsset(name, pool);
    return fuzzy ? { node: fuzzy, fuzzy: true } : null;
}

function clipAssetMention(node: CanvasNodeData, label = node.title || node.id) {
    const safeLabel = String(label || node.id).replace(/[\[\]()]/g, " ").replace(/\s+/g, " ").trim() || "参考素材";
    return serializeCanvasResourceMention(node.id, safeLabel);
}
