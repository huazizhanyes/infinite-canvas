import { canvasScriptApi, type ScriptAnalysisRun, type ScriptGenerationBatch } from "@/services/api/canvas-script";
import type { UserAssetConnection } from "@/services/api/user-assets";

const POLL_INTERVAL = 3000;

export async function waitForAssetAnalysis(connection: UserAssetConnection, runId: string): Promise<ScriptAnalysisRun> {
    for (;;) {
        const run = await canvasScriptApi.getAnalysis(connection, runId);
        if (!["queued", "running"].includes(run.status)) return run;
        await delay(POLL_INTERVAL);
    }
}

export async function waitForAssetImages(connection: UserAssetConnection, batchId: string, onUpdate?: (batch: ScriptGenerationBatch) => void): Promise<ScriptGenerationBatch> {
    for (;;) {
        const batch = await canvasScriptApi.getGenerationBatch(connection, batchId);
        onUpdate?.(batch);
        if (batch.status !== "running") return batch;
        await delay(POLL_INTERVAL);
    }
}

function delay(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}
