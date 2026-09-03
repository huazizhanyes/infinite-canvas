import { describe, expect, it } from "vitest";

import { serializeCanvasProjectForCloud } from "./canvas-cloud-serialization";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "@/types/canvas";

describe("canvas cloud serialization", () => {
    it("keeps stable media identities and removes device-only image locations", () => {
        const project = createProject({ content: "blob:local", storageKey: "image:u1:one", mediaId: "media-1" });
        const serialized = serializeCanvasProjectForCloud(project);

        expect(serialized.nodes[0].metadata).toEqual(expect.objectContaining({ content: "", mediaId: "media-1" }));
        expect(serialized.nodes[0].metadata).not.toHaveProperty("storageKey");
        expect(project.nodes[0].metadata).toEqual(expect.objectContaining({ content: "blob:local", storageKey: "image:u1:one" }));
    });

    it("keeps stable public legacy URLs but removes signed URLs", () => {
        const publicProject = createProject({ content: "https://cdn.example.com/image.png" });
        const signedProject = createProject({ content: "https://oss.example.com/image.png?Expires=1&Signature=old" });

        expect(serializeCanvasProjectForCloud(publicProject).nodes[0].metadata?.content).toBe("https://cdn.example.com/image.png");
        expect(serializeCanvasProjectForCloud(signedProject).nodes[0].metadata?.content).toBe("");
    });

    it("removes device-only locations from nested assistant and snapshot images", () => {
        const project = createProject({
            content: "blob:local",
            mediaId: "media-1",
            scriptAssetSourceSnapshot: { sourceNodeId: "image-2", sourceMediaId: "media-2", sourceStorageKey: "image:u1:two", sourceImageUrl: "blob:snapshot", sourceTitle: "snapshot", sourceType: "character", capturedAt: 1 },
        });
        project.chatSessions = [{ id: "chat-1", title: "chat", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", messages: [{ id: "message-1", role: "assistant", text: "", references: [{ id: "reference-1", type: CanvasNodeType.Image, title: "image", dataUrl: "blob:assistant", storageKey: "image:u1:three", mediaId: "media-3" }] }] }];

        const serialized = serializeCanvasProjectForCloud(project);
        const snapshot = serialized.nodes[0].metadata?.scriptAssetSourceSnapshot;
        const reference = serialized.chatSessions[0].messages[0].references?.[0];

        expect(snapshot).toEqual(expect.objectContaining({ sourceMediaId: "media-2", sourceImageUrl: "" }));
        expect(snapshot).not.toHaveProperty("sourceStorageKey");
        expect(reference).toEqual(expect.objectContaining({ mediaId: "media-3", dataUrl: "" }));
        expect(reference).not.toHaveProperty("storageKey");
    });
});

function createProject(metadata: CanvasProject["nodes"][number]["metadata"]): CanvasProject {
    return {
        id: "project-1",
        title: "test",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        nodes: [{ id: "image-1", type: CanvasNodeType.Image, title: "image", position: { x: 0, y: 0 }, width: 100, height: 100, metadata }],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    };
}
