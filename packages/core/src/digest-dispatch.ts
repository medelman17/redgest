import type { DomainEventBus } from "./events/bus.js";
import type { PipelineDeps } from "./pipeline/types.js";
import { runDigestPipeline } from "./pipeline/orchestrator.js";

export interface DigestDispatchDeps {
  eventBus: DomainEventBus;
  pipelineDeps: PipelineDeps;
  triggerSecretKey?: string;
}

/**
 * Wires the DigestRequested event to either Trigger.dev (if configured)
 * or an in-process pipeline fallback.
 *
 * Shared between MCP server bootstrap and Next.js DAL — both need identical
 * dispatch behavior. Extracted to avoid the DRY violation that caused bug
 * fixes (like #3) to require changes in two places.
 */
export function wireDigestDispatch(deps: DigestDispatchDeps): void {
  const { eventBus, pipelineDeps, triggerSecretKey } = deps;
  const { db } = pipelineDeps;

  async function runInProcess(
    jobId: string,
    subredditIds: string[],
  ): Promise<void> {
    try {
      await runDigestPipeline(jobId, subredditIds, pipelineDeps);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[DigestRequested] Pipeline failed for job ${jobId}: ${message}`,
      );
      try {
        await db.job.update({
          where: { id: jobId },
          data: { status: "FAILED", completedAt: new Date(), error: message },
        });
      } catch {
        console.error(
          `[DigestRequested] Failed to update job ${jobId} status to FAILED`,
        );
      }
    }
  }

  eventBus.on("DigestRequested", async (event) => {
    const { jobId, subredditIds } = event.payload;

    if (triggerSecretKey) {
      try {
        const { tasks } = await import("@trigger.dev/sdk/v3");
        await tasks.trigger("generate-digest", { jobId, subredditIds });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[DigestRequested] Trigger.dev dispatch failed: ${message}, falling back to in-process`,
        );
        await runInProcess(jobId, subredditIds);
      }
    } else {
      await runInProcess(jobId, subredditIds);
    }
  });
}
