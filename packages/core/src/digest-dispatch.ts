import type { EventBus } from "./events/bus.js";
import type { PipelineDeps } from "./pipeline/types.js";
import { runDigestPipeline } from "./pipeline/orchestrator.js";

export interface DigestDispatchDeps {
  eventBus: EventBus;
  pipelineDeps: PipelineDeps;
  triggerSecretKey?: string;
  /** Injected delivery function — called on DigestCompleted when Trigger.dev is not configured. */
  deliverDigest?: (digestId: string, jobId: string) => Promise<void>;
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
  const { eventBus, pipelineDeps, triggerSecretKey, deliverDigest } = deps;
  const { db } = pipelineDeps;

  async function runInProcess(
    jobId: string,
    subredditIds: string[],
    forceRefresh?: boolean,
    maxPosts?: number,
    organizationId?: string,
  ): Promise<void> {
    try {
      const deps = {
        ...pipelineDeps,
        ...(forceRefresh ? { forceRefresh: true as const } : {}),
        ...(maxPosts !== undefined ? { maxPosts } : {}),
        ...(organizationId ? { organizationId } : {}),
      };
      await runDigestPipeline(jobId, subredditIds, deps);
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

  eventBus.subscribe("DigestRequested", async (event) => {
    const { jobId, subredditIds, forceRefresh, maxPosts } = event.payload;
    const organizationId = event.organizationId ?? undefined;

    if (triggerSecretKey) {
      try {
        const { tasks } = await import("@trigger.dev/sdk/v3");
        await tasks.trigger("generate-digest", { jobId, subredditIds, organizationId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[DigestRequested] Trigger.dev dispatch failed: ${message}, falling back to in-process`,
        );
        await runInProcess(jobId, subredditIds, forceRefresh, maxPosts, organizationId);
      }
    } else {
      await runInProcess(jobId, subredditIds, forceRefresh, maxPosts, organizationId);
    }
  });

  // In-process delivery on DigestCompleted (when Trigger.dev not available)
  if (!triggerSecretKey && deliverDigest) {
    eventBus.subscribe("DigestCompleted", async (event) => {
      const { jobId, digestId } = event.payload;
      try {
        await deliverDigest(digestId, jobId);
      } catch (err) {
        console.error(
          `[DigestCompleted] In-process delivery failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    });
  }
}
