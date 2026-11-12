import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
    projects: [] as Array<{ id: string; localDirty: boolean; localRevision: number }>,
    flush: vi.fn(async () => {}),
    drain: vi.fn(async (_id?: string) => true),
}));
vi.mock('@/stores/canvas/use-canvas-store', () => ({ flushCanvasPersistence: fixture.flush, useCanvasStore: { getState: () => fixture } }));
vi.mock('@/services/sucai-canvas-sync', () => ({ drainSucaiCanvasSync: fixture.drain }));

describe('active canvas exit persistence', () => {
    beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); fixture.projects = [{ id: 'a', localDirty: true, localRevision: 1 }]; fixture.flush.mockResolvedValue(); fixture.drain.mockResolvedValue(true); });
    afterEach(() => { vi.useRealTimers(); });

    it('commits edits made while the exit request is still in flight', async () => {
        const persistence = await import('./canvas-persistence');
        let edited = false;
        fixture.drain.mockImplementationOnce(async () => { edited = true; fixture.projects[0].localDirty = false; return true; });
        persistence.registerActiveCanvasPersistence('a', () => { if (edited) { edited = false; fixture.projects[0] = { id: 'a', localDirty: true, localRevision: 2 }; } });
        fixture.drain.mockImplementation(async () => { fixture.projects[0].localDirty = false; return true; });
        expect(await persistence.flushActiveCanvasPersistence()).toBe(true);
        expect(fixture.drain).toHaveBeenCalledTimes(2);
        expect(fixture.projects[0]).toMatchObject({ localRevision: 2, localDirty: false });
    });

    it('retains the newly active project when the old page unregisters', async () => {
        const persistence = await import('./canvas-persistence');
        const oldCommit = vi.fn(), newCommit = vi.fn();
        const unregister = persistence.registerActiveCanvasPersistence('old', oldCommit);
        persistence.registerActiveCanvasPersistence('new', newCommit); unregister();
        await persistence.flushActiveCanvasPersistence();
        expect(oldCommit).not.toHaveBeenCalled();
        expect(newCommit).toHaveBeenCalled();
        expect(fixture.drain).toHaveBeenCalledWith('new');
    });

    it('bounds network waiting after local persistence succeeds', async () => {
        vi.useFakeTimers();
        const persistence = await import('./canvas-persistence');
        persistence.registerActiveCanvasPersistence('a', () => {});
        let finish!: (value: boolean) => void;
        fixture.drain.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const result = persistence.flushActiveCanvasPersistence();
        await vi.advanceTimersByTimeAsync(5000);
        expect(await result).toBe(false);
        expect(fixture.flush).toHaveBeenCalled();
        finish(true);
    });

    it('rejects local disk errors instead of permitting an unsafe exit', async () => {
        const persistence = await import('./canvas-persistence');
        fixture.flush.mockRejectedValueOnce(new Error('disk full'));
        await expect(persistence.flushActiveCanvasPersistence()).rejects.toThrow('disk full');
        expect(fixture.drain).not.toHaveBeenCalled();
    });
});
