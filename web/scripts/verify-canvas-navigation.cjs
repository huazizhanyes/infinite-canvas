const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "@playwright/test");

async function main() {
    const origin = process.env.CANVAS_TEST_ORIGIN || "http://127.0.0.1:3107";
    const cycles = Number(process.env.CANVAS_TEST_CYCLES || 50);
    assert.equal(new URL(origin).hostname, "127.0.0.1");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const remote = new Map(), receipts = new Map(), writes = [], errors = [];
    let delay = 0, loseAck = false, lostId = null, offline = false;
    await context.route("**/*", async route => {
        const req = route.request(), url = new URL(req.url());
        const respond = data => route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: 200, data }) });
        if (url.pathname.startsWith("/__nav_api/")) {
            const id = decodeURIComponent(url.pathname.split("/").pop());
            if (url.pathname.includes("projects-directory")) return respond({ projects: [...remote.values()].map(p => ({ id: p.id, title: p.title, createdAt: p.createdAt, updatedAt: p.updatedAt, serverVersion: p.serverVersion, detailLoaded: false })), deleted: [], nextCursor: null });
            if (req.method() === "PUT") {
                const body = req.postDataJSON(), current = remote.get(id);
                writes.push(body);
                if (offline) return route.abort('failed');
                if (delay) await new Promise(resolve => setTimeout(resolve, delay));
                if (body.expectedVersion !== (current?.serverVersion || 0)) {
                    const receipt = receipts.get(id);
                    return receipt && JSON.stringify(receipt) === JSON.stringify(body)
                        ? respond({ duplicate: true, metadata: { id, serverVersion: current.serverVersion } })
                        : respond({ conflict: true, metadata: { id, serverVersion: current?.serverVersion || 0 } });
                }
                const next = { ...body.project, serverVersion: (current?.serverVersion || 0) + 1 };
                remote.set(id, next); receipts.set(id, body);
                if (loseAck) { loseAck = false; lostId = id; return route.abort("failed"); }
                return respond({ metadata: { id, serverVersion: next.serverVersion } });
            }
            return respond({ project: remote.get(id) });
        }
        // All external/paid services are isolated. No test uses a real account or database.
        if (url.pathname.includes("/canvas/v1/") || url.pathname.includes("/flash-api/")) return respond(url.pathname.includes("identity") ? { id: "mounted-fixture", username: "test", displayName: "test" } : url.pathname.includes("projects-directory") ? { projects: [], deleted: [], nextCursor: null } : url.pathname.includes("assets") ? { assets: [] } : []);
        if (url.origin !== origin) return route.abort();
        return route.continue();
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    const bootSync = async () => {
        await page.evaluate(async () => {
            const scope = await import("/src/lib/canvas-account-scope.ts");
            scope.setCanvasAccountScope("mounted-fixture");
            const store = await import("/src/stores/canvas/use-canvas-store.ts");
            const sync = await import("/src/services/sucai-canvas-sync.ts");
            window.canvasTest = { ...store, ...sync };
            await store.rehydrateCanvasStoreForAccount();
            await sync.initializeSucaiCanvasSync({ baseUrl: location.origin + "/__nav_api", token: "fixture", userId: "mounted-fixture" });
        });
        await page.waitForFunction(() => !window.canvasTest.useCanvasDirectoryStatus.getState().loading);
    };
    const state = () => page.evaluate(() => window.canvasTest.useCanvasStore.getState().projects);
    const currentId = () => page.url().split("/").pop();
    const menu = async label => { await page.getByRole("button", { name: "打开画布菜单", exact: true }).click(); await page.getByRole("menuitem", { name: label, exact: true }).click(); };
    try {
        await page.goto(origin + "/canvas"); await bootSync();
        await page.getByRole("button", { name: /创建新的画布/ }).click();
        await page.getByRole("button", { name: "打开画布菜单", exact: true }).waitFor();
        const firstId = currentId();
        for (const width of [900, 1280, 1920]) {
            await page.setViewportSize({ width, height: 900 });
            const save = page.getByRole("button", { name: "立即保存并重试同步", exact: true });
            await save.click({ trial: true });
        }
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.locator("button[aria-label=文本]").click();
        // Create a new canvas before the 250ms component debounce or 3s cloud debounce.
        delay = 120; await menu("新建画布");
        await page.waitForURL(url => url.pathname.startsWith("/canvas/") && !url.pathname.endsWith(firstId));
        const secondId = currentId();
        await page.waitForFunction(id => document.querySelector("main[data-canvas-project-id]")?.dataset.canvasProjectId === id, secondId);
        let projects = await state();
        assert.equal(projects.find(p => p.id === firstId).nodes.length, 1);
        assert.equal(projects.find(p => p.id === secondId).nodes.length, 0, "previous canvas nodes leaked into newly created project");
        await menu("我的画布"); await page.waitForURL(origin + "/canvas");
        for (let i = 0; i < cycles; i++) {
            const id = i % 2 ? firstId : secondId;
            const p = (await state()).find(p => p.id === id);
            await page.getByRole("article", { name: "打开 " + p.title, exact: true }).click();
            await page.waitForFunction(id => document.querySelector("main[data-canvas-project-id]")?.dataset.canvasProjectId === id, id);
            if (i % 10 === 0) await page.locator("button[aria-label=文本]").click();
            else await page.mouse.click(850 + i % 20, 500);
            if (i % 7 === 0) { await page.evaluate(() => history.back()); }
            else await menu("我的画布");
            await page.waitForURL(origin + "/canvas");
            await page.locator(".canvas-library-shell").waitFor();
        }
        projects = await state();
        assert.equal(projects.length, 2);
        for (const p of projects) assert.deepEqual(remote.get(p.id).nodes, p.nodes);
        const settledWrites = writes.length;
        for (let i = 0; i < 4; i++) {
            const p = (await state()).find(p => p.id === firstId);
            await page.getByRole("article", { name: "打开 " + p.title, exact: true }).click();
            await page.waitForFunction(id => document.querySelector("main[data-canvas-project-id]")?.dataset.canvasProjectId === id, firstId);
            await menu("我的画布"); await page.waitForURL(origin + "/canvas");
            await page.locator(".canvas-library-shell").waitFor();
        }
        assert.equal(writes.length, settledWrites, 'opening and exiting an unchanged canvas caused extra document writes');
        // A committed save with lost response, full reload, and retry must remain one project.
        const first = projects.find(p => p.id === firstId);
        await page.getByRole("article", { name: "打开 " + first.title, exact: true }).click();
        await page.waitForFunction(id => document.querySelector("main[data-canvas-project-id]")?.dataset.canvasProjectId === id, firstId);
        await page.locator("button[aria-label=文本]").click(); loseAck = true;
        await menu("我的画布"); await page.waitForURL(origin + "/canvas");
        if (lostId !== firstId) console.log(JSON.stringify({ lostAckDiagnostic: { lostId, firstId, loseAck, latest: writes.slice(-3).map(w => ({ id: w.project.id, nodes: w.project.nodes.length, expected: w.expectedVersion })), state: (await state()).map(p => ({ id:p.id,nodes:p.nodes?.length,dirty:p.localDirty,version:p.serverVersion })), ui: await page.evaluate(() => window.canvasTest.useCanvasDirectoryStatus.getState()) } }));
        assert.equal(lostId, firstId);
        await page.reload(); await bootSync();
        await page.evaluate(() => window.canvasTest.drainSucaiCanvasSync());
        assert.equal((await state()).length, 2);
        const recovered = (await state()).find(p => p.id === firstId);
        assert.equal(recovered.localDirty, false);
        assert.deepEqual(remote.get(firstId).nodes, recovered.nodes);
        // An unrelated project conflict must not display its toast on the current canvas.
        const second = (await state()).find(p => p.id === secondId);
        await page.getByRole("article", { name: "打开 " + second.title, exact: true }).click();
        await page.waitForURL(origin + "/canvas/" + secondId);
        await page.waitForFunction(id => document.querySelector("main[data-canvas-project-id]")?.dataset.canvasProjectId === id, secondId);
        await page.evaluate(firstId => window.canvasTest.useCanvasDirectoryStatus.setState({ conflict: "OLD-PROJECT-CONFLICT", conflictProjectId: firstId }), firstId);
        await page.waitForTimeout(100);
        assert.equal(await page.getByText("OLD-PROJECT-CONFLICT", { exact: true }).count(), 0);
        await page.locator("button[aria-label=文本]").click();
        const blocksClose = await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
        assert.equal(blocksClose, true, 'unsynced tab close must be guarded');
        offline = true;
        await menu("我的画布"); await page.waitForURL(origin + "/canvas");
        assert.equal((await state()).find(p => p.id === secondId).localDirty, true);
        assert.equal((await state()).length, 2);
        offline = false;
        await page.evaluate(() => window.canvasTest.drainSucaiCanvasSync());
        const resumed = (await state()).find(p => p.id === secondId);
        assert.equal(resumed.localDirty, false);
        assert.deepEqual(remote.get(secondId).nodes, resumed.nodes);
        // Existing users must have a working recovery action after dismissing the conflict.
        await page.getByRole("article", { name: "打开 " + resumed.title, exact: true }).click();
        await page.waitForFunction(id => document.querySelector("main[data-canvas-project-id]")?.dataset.canvasProjectId === id, secondId);
        remote.set(secondId, { ...remote.get(secondId), title: '其他页面更新', serverVersion: remote.get(secondId).serverVersion + 1 });
        await page.locator("button[aria-label=文本]").click();
        await page.evaluate(async () => { const p = await import('/src/services/canvas-persistence.ts'); await p.flushActiveCanvasPersistence(); });
        await page.getByRole("button", { name: /稍\s*后/ }).click();
        await page.locator('.ant-modal-wrap').waitFor({ state: 'hidden' });
        const conflicted = (await state()).find(p => p.id === secondId);
        assert.ok(conflicted.localConflictCopyId);
        const localNodes = conflicted.nodes;
        await page.reload(); await bootSync();
        await page.waitForFunction(id => document.querySelector("main[data-canvas-project-id]")?.dataset.canvasProjectId === id, secondId);
        await page.getByRole("button", { name: "加载云端版本", exact: true }).waitFor();
        await page.getByRole("button", { name: /稍\s*后/ }).click();
        await page.locator('.ant-modal-wrap').waitFor({ state: 'hidden' });
        await page.getByRole("button", { name: "处理同步冲突", exact: true }).click();
        await page.getByRole("button", { name: "加载云端版本", exact: true }).waitFor();
        await page.evaluate(async id => { try { await window.canvasTest.syncSucaiCanvasProject(id); } catch {} }, secondId);
        assert.equal(await page.getByRole("button", { name: "加载云端版本", exact: true }).count(), 1, 'repeated conflict events stacked dialogs');
        await page.getByRole("button", { name: /稍\s*后/ }).click();
        await page.locator('.ant-modal-wrap').waitFor({ state: 'hidden' });
        await page.evaluate(async id => { try { await window.canvasTest.syncSucaiCanvasProject(id); throw Error('unresolved conflict allowed generation'); } catch (error) { if (!error.message.includes('处理同步冲突')) throw error; } }, secondId);
        await page.getByRole("button", { name: "加载云端版本", exact: true }).waitFor();
        await Promise.all([page.waitForEvent('framenavigated', frame => frame === page.mainFrame()), page.getByRole("button", { name: "加载云端版本", exact: true }).click()]);
        await bootSync();
        await page.waitForFunction(id => document.querySelector("main[data-canvas-project-id]")?.dataset.canvasProjectId === id, secondId);
        await page.evaluate(id => window.canvasTest.syncSucaiCanvasProject(id), secondId);
        const retained = await page.evaluate(id => window.canvasTest.loadSucaiCanvasProject(id), conflicted.localConflictCopyId);
        const recoveredProjects = await state();
        assert.deepEqual(retained.nodes, localNodes);
        assert.equal(recoveredProjects.find(p => p.id === secondId).localConflictCopyId, undefined);
        assert.deepEqual(recoveredProjects.find(p => p.id === secondId).nodes, remote.get(secondId).nodes);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ passed: true, cycles, checks: ["mounted-react-router", "responsive-save-button", "new-project-isolation", "exit-before-debounce", "delayed-save", "rapid-reentry", "lost-ack-reload", "project-scoped-warning", "unchanged-write-suppression", "unsynced-close-guard", "offline-exit-retry", "dismissed-conflict-reopen", "generation-conflict-action", "recovery-retains-local-copy"], writes: writes.length, projects: (await state()).length }));
    } finally { await context.close(); await browser.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
