import type { QueryHandler } from "../types.js";
import type {
  RunStatusSteps,
  SubredditStepDetail,
  StructuredError,
} from "../types.js";

/** Event types emitted by the pipeline that carry step-level data. */
const STEP_EVENT_TYPES = [
  "PostsFetched",
  "PostsTriaged",
  "PostsSummarized",
  "DigestCompleted",
  "DigestFailed",
  "DigestCanceled",
] as const;

/** Parse the Job.error string into structured errors with step/subreddit context. */
function parseStructuredErrors(error: string | null): StructuredError[] {
  if (!error) return [];

  return error.split("; ").map((segment) => {
    // Pattern: "Failed to summarize post <redditId>: <message>"
    const summarizeMatch = segment.match(
      /^Failed to summarize post (\S+): (.+)$/,
    );
    if (summarizeMatch) {
      return {
        step: "summarize",
        message: summarizeMatch[2] ?? segment,
      };
    }

    // Pattern: "Failed to process r/<name>: <message>"
    const subredditMatch = segment.match(
      /^Failed to process r\/(\S+): (.+)$/,
    );
    if (subredditMatch) {
      return {
        step: "fetch",
        subreddit: subredditMatch[1],
        message: subredditMatch[2] ?? segment,
      };
    }

    // Fallback: unstructured error
    return { step: "unknown", message: segment };
  });
}

interface EventRow {
  type: string;
  payload: unknown;
  createdAt: Date;
}

/** Build step breakdown from event history. */
function buildSteps(events: EventRow[]): RunStatusSteps {
  const fetch: SubredditStepDetail[] = [];
  const triage: SubredditStepDetail[] = [];
  const summarize: SubredditStepDetail[] = [];
  const assemble: RunStatusSteps["assemble"] = { status: "pending" };

  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;
    const timestamp = event.createdAt.toISOString();

    switch (event.type) {
      case "PostsFetched":
        fetch.push({
          subreddit: String(payload["subreddit"] ?? ""),
          count: Number(payload["count"] ?? 0),
          completedAt: timestamp,
        });
        break;
      case "PostsTriaged": {
        // Global triage: subreddits is an array; legacy: subreddit is a string
        const subs = payload["subreddits"];
        const subredditLabel = Array.isArray(subs) ? (subs as string[]).join(", ") : String(payload["subreddit"] ?? "");
        triage.push({
          subreddit: subredditLabel,
          count: Number(payload["selectedCount"] ?? 0),
          completedAt: timestamp,
        });
        break;
      }
      case "PostsSummarized":
        summarize.push({
          subreddit: "all",
          count: Number(payload["summaryCount"] ?? 0),
          completedAt: timestamp,
        });
        break;
      case "DigestCompleted":
        assemble.status = "completed";
        assemble.digestId = String(payload["digestId"] ?? "");
        assemble.completedAt = timestamp;
        break;
    }
  }

  return { fetch, triage, summarize, assemble };
}

export const handleGetRunStatus: QueryHandler<"GetRunStatus"> = async (
  params,
  ctx,
) => {
  const runView = await ctx.db.runView.findUnique({
    where: { jobId: params.jobId },
  });

  if (!runView) return null;

  // Fetch all pipeline events for this job, ordered chronologically
  const events = await ctx.db.event.findMany({
    where: {
      aggregateId: params.jobId,
      aggregateType: "job",
      type: { in: [...STEP_EVENT_TYPES] },
    },
    orderBy: { createdAt: "asc" },
    select: { type: true, payload: true, createdAt: true },
  });

  const steps = buildSteps(events);
  const structuredErrors = parseStructuredErrors(runView.error);

  return { ...runView, steps, structuredErrors };
};
