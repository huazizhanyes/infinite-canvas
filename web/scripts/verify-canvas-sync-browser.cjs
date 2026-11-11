// Start the frontend dev server first. PLAYWRIGHT_MODULE may point at an installed @playwright/test.
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "@playwright/test");

async function main() {
    const origin = process.env.CANVAS_TEST_ORIGIN || "http://127.0.0.1:3000";
    assert.ok(new URL(origin).hostname === "127.0.0.1" || new URL(origin).hostname === "localhost");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const now = new Date().toISOString();
    let remote = { id: "browser-fixture", title: "浏览器验证", createdAt: now, updatedAt: now, serverVersion: 1, nodes: [{ id: "v", type: "video", title: "视频", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { generationRequestId: "retry-request", status: "loading" } }], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } };
    const errors = [];
    const savedVersions = [];
    let resolveOldDirectory;
    let delayedPage = null;
    await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === "/__canvas_sync_test") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Canvas sync regression</title>" });
        if (!url.pathname.startsWith("/__sync_api/")) return route.continue();
        const respond = data => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data }) });
        if (url.pathname.includes("projects-directory")) {
            const metadata = { ...remote, detailLoaded: false }; delete metadata.nodes; delete metadata.connections;
            if (delayedPage === request.frame().page()) {
                delayedPage = null; await new Promise(resolve => { resolveOldDirectory = resolve; });
            }
            return respond({ projects: [metadata], deleted: [], nextCursor: null });
        }
        if (request.method() === "PUT") {
            const body = request.postDataJSON();
            if (body.expectedVersion !== remote.serverVersion) return respond({ conflict: true, metadata: { id: remote.id, serverVersion: remote.serverVersion, detailLoaded: false } });
            remote = { ...body.project, serverVersion: remote.serverVersion + 1 };
            savedVersions.push(remote.serverVersion);
            return respond({ metadata: { id: remote.id, serverVersion: remote.serverVersion } });
        }
        return respond({ project: remote });
    });
    const boot = async page => {
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(`${origin}/__canvas_sync_test`);
        await page.evaluate(async () => {
            const scope = await import("/src/lib/canvas-account-scope.ts");
            scope.setCanvasAccountScope("browser-test");
            const store = await import("/src/stores/canvas/use-canvas-store.ts");
            const sync = await import("/src/services/sucai-canvas-sync.ts");
            await store.rehydrateCanvasStoreForAccount();
            window.testCanvas = { ...store, ...sync };
            await sync.initializeSucaiCanvasSync({ baseUrl: location.origin + "/__sync_api", token: "fixture", userId: "browser-test" });
        });
        await page.waitForFunction(() => !window.testCanvas.useCanvasDirectoryStatus.getState().loading);
        await page.evaluate(async () => { await window.testCanvas.loadSucaiCanvasProject("browser-fixture"); });
    };
    const edit = async (page, content) => page.evaluate(async content => {
        const c = window.testCanvas, s = c.useCanvasStore.getState(), p = s.openProject("browser-fixture");
        s.updateProject(p.id, { nodes: p.nodes.map(node => ({ ...node, metadata: { ...node.metadata, videoTaskId: "completed-fixture", status: "success", content } })) });
        await c.flushCanvasPersistence();
    }, content);
    const snapshot = page => page.evaluate(() => {
        const c = window.testCanvas, p = c.useCanvasStore.getState().openProject("browser-fixture");
        return { project: p, copy: p?.localConflictCopyId ? c.useCanvasStore.getState().openProject(p.localConflictCopyId) : null };
    });
    try {
        const a = await context.newPage(), b = await context.newPage();
        await boot(a); await boot(b);
        delayedPage = a;
        await a.evaluate(async () => {
            const ui = await import("/src/stores/canvas/use-canvas-ui-store.ts");
            ui.useCanvasUiStore.getState().setExternalUpdate(null);
            window.dispatchEvent(new StorageEvent("storage", { key: "canvas:project-updated", newValue: JSON.stringify({ id: "browser-fixture" }) }));
        });
        await a.waitForFunction(() => window.testCanvas.useCanvasDirectoryStatus.getState().loading);
        await edit(a, "https://fixture.test/a.mp4");
        assert.equal(await a.evaluate(() => window.testCanvas.flushSucaiCanvasSync()), true);
        resolveOldDirectory();
        await a.waitForFunction(() => !window.testCanvas.useCanvasDirectoryStatus.getState().loading);
        assert.equal((await snapshot(a)).project.serverVersion, 2);
        assert.equal((await snapshot(a)).project.nodes[0].metadata.content, "https://fixture.test/a.mp4");
        await edit(b, "https://fixture.test/b.mp4");
        assert.equal(await b.evaluate(() => window.testCanvas.flushSucaiCanvasSync()), false);
        const conflicted = await snapshot(b); assert.ok(conflicted.project.localConflictCopyId);
        await edit(b, "https://fixture.test/b-completed.mp4");
        assert.equal((await snapshot(b)).copy.nodes[0].metadata.content, "https://fixture.test/b-completed.mp4");
        assert.equal(remote.nodes[0].metadata.content, "https://fixture.test/a.mp4");
        await b.evaluate(() => window.testCanvas.stopSucaiCanvasSync());
        await b.reload(); await boot(b);
        const restored = await snapshot(b);
        assert.equal(restored.project.nodes[0].metadata.content, "https://fixture.test/b-completed.mp4");
        const copyId = restored.project.localConflictCopyId;
        const copy = await b.evaluate(id => window.testCanvas.loadSucaiCanvasProject(id), copyId);
        assert.equal(copy.nodes[0].metadata.content, "https://fixture.test/b-completed.mp4");
        assert.equal(copy.localConflictSourceProjectId, "browser-fixture");
        await b.evaluate(() => window.testCanvas.reloadSucaiCanvasProject("browser-fixture"));
        assert.equal((await snapshot(b)).project.nodes[0].metadata.content, "https://fixture.test/a.mp4");
        await b.evaluate(() => window.testCanvas.flushCanvasPersistence());
        await a.evaluate(() => window.testCanvas.stopSucaiCanvasSync());
        await b.evaluate(() => window.testCanvas.stopSucaiCanvasSync());
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ browser: browser.version(), passed: true, checks: ["real-browser-modules", "delayed-directory", "two-tab-conflict", "subsequent-completion", "cloud-not-overwritten", "IndexedDB-reload", "conflict-copy-reload", "explicit-remote-reload"], savedVersions }));
    } finally { await context.close(); await browser.close(); }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
