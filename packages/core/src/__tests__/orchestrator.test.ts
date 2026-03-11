import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@redgest/db";
import type { DomainEventBus } from "../events/bus.js";
import type { RedgestConfig } from "@redgest/config";
import { runDigestPipeline } from "../pipeline/orchestrator.js";
import type {
  PipelineDeps,
  ContentSource,
  PostSummary,
  FetchStepResult,
  TriageStepResult,
  SummarizeStepResult,
  AssembleStepResult,
  ModelConfig,
} from "../pipeline/types.js";

// --- Mocks ---
vi.mock("../pipeline/fetch-step.js", () => ({ fetchStep: vi.fn() }));
vi.mock("../pipeline/triage-step.js", () => ({ triageStep: vi.fn() }));
vi.mock("../pipeline/summarize-step.js", () => ({ summarizeStep: vi.fn() }));
vi.mock("../pipeline/assemble-step.js", () => ({ assembleStep: vi.fn() }));
vi.mock("../pipeline/dedup.js", () => ({ findPreviousPostIds: vi.fn() }));
vi.mock("../events/persist.js", () => ({ persistEvent: vi.fn() }));
vi.mock("@redgest/llm", () => ({ getModel: vi.fn() }));

// Import mocked functions for assertions
import { fetchStep } from "../pipeline/fetch-step.js";
import { triageStep } from "../pipeline/triage-step.js";
import { summarizeStep } from "../pipeline/summarize-step.js";
import { assembleStep } from "../pipeline/assemble-step.js";
import { findPreviousPostIds } from "../pipeline/dedup.js";
import { persistEvent } from "../events/persist.js";
import { getModel } from "@redgest/llm";

const mockFetchStep = vi.mocked(fetchStep);
const mockTriageStep = vi.mocked(triageStep);
const mockSummarizeStep = vi.mocked(summarizeStep);
const mockAssembleStep = vi.mocked(assembleStep);
const mockFindPreviousPostIds = vi.mocked(findPreviousPostIds);
const mockPersistEvent = vi.mocked(persistEvent);
const mockGetModel = vi.mocked(getModel);

// --- Helpers ---

function makeSummary(overrides: Partial<PostSummary> = {}): PostSummary {
  return {
    summary: "A test summary.",
    keyTakeaways: ["Takeaway 1"],
    insightNotes: "Relevant insight",
    communityConsensus: null,
    commentHighlights: [],
    sentiment: "positive",
    relevanceScore: 8,
    contentType: "text",
    notableLinks: [],
    ...overrides,
  };
}

function makeFetchResult(subreddit: string): FetchStepResult {
  return {
    subreddit,
    posts: [
      {
        postId: "post-1",
        redditId: "reddit-1",
        post: {
          id: "reddit-1",
          name: "t3_reddit1",
          subreddit,
          title: "Test Post 1",
          selftext: "Post body text",
          author: "testuser",
          score: 100,
          num_comments: 25,
          url: "https://reddit.com/r/test/1",
          permalink: "/r/test/1",
          link_flair_text: null,
          over_18: false,
          created_utc: 1700000000,
          is_self: true,
        },
        comments: [
          {
            id: "c1",
            name: "t1_c1",
            author: "commenter1",
            body: "Great post!",
            score: 10,
            depth: 0,
            created_utc: 1700000100,
          },
        ],
      },
    ],
    fetchedAt: new Date(),
  };
}

function makeTriageResult(): TriageStepResult {
  return {
    selected: [
      { index: 0, relevanceScore: 8, rationale: "Highly relevant" },
    ],
  };
}

function makeSummarizeResult(): SummarizeStepResult {
  return {
    postSummaryId: "ps-1",
    summary: makeSummary(),
  };
}

function makeAssembleResult(): AssembleStepResult {
  return {
    digestId: "digest-1",
    contentMarkdown: "# Test Digest",
    postCount: 1,
  };
}

function makeSubreddit(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-1",
    name: "typescript",
    insightPrompt: "TypeScript and web development",
    maxPosts: 5,
    includeNsfw: false,
    isActive: true,
    ...overrides,
  };
}

/** Extract event type names from persistEvent mock calls. */
function getPersistedEventTypes(): string[] {
  return mockPersistEvent.mock.calls.map((call) => {
    const event = call[1] as unknown as Record<string, unknown>;
    return event["type"] as string;
  });
}

/** Extract event type names from eventBus.emitEvent mock calls. */
function getEmittedEventTypes(
  bus: { emitEvent: ReturnType<typeof vi.fn> },
): string[] {
  return bus.emitEvent.mock.calls.map((call: unknown[]) => {
    const event = call[0] as unknown as Record<string, unknown>;
    return event["type"] as string;
  });
}

/** Find a persisted event by type and return its payload. */
function findPersistedEvent(
  eventType: string,
): Record<string, unknown> | undefined {
  const call = mockPersistEvent.mock.calls.find((c) => {
    const event = c[1] as unknown as Record<string, unknown>;
    return event["type"] === eventType;
  });
  if (!call) return undefined;
  const event = call[1] as unknown as Record<string, unknown>;
  return event["payload"] as Record<string, unknown>;
}

/** Get the last job.update call's data argument. */
function getLastJobUpdate(
  db: { job: { update: ReturnType<typeof vi.fn> } },
): Record<string, unknown> {
  const calls = db.job.update.mock.calls;
  const lastCall = calls[calls.length - 1] as unknown as [
    { data: Record<string, unknown> },
  ];
  return lastCall[0].data;
}

// --- Mock DB, EventBus, Deps ---

let mockDb: {
  job: { update: ReturnType<typeof vi.fn> };
  subreddit: { findMany: ReturnType<typeof vi.fn> };
  config: { findFirst: ReturnType<typeof vi.fn> };
};

let mockEventBus: { emitEvent: ReturnType<typeof vi.fn> };
let mockContentSource: ContentSource;
let mockConfig: RedgestConfig;
let deps: PipelineDeps;

beforeEach(() => {
  vi.clearAllMocks();

  mockDb = {
    job: { update: vi.fn().mockResolvedValue({}) },
    subreddit: {
      findMany: vi.fn().mockResolvedValue([makeSubreddit()]),
    },
    config: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ globalInsightPrompt: "global test prompt" }),
    },
  };

  mockEventBus = { emitEvent: vi.fn() };
  mockContentSource = { fetchContent: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test mock
  mockConfig = {} as RedgestConfig;

  deps = {
    db: mockDb as unknown as PrismaClient,
    eventBus: mockEventBus as unknown as DomainEventBus,
    contentSource: mockContentSource,
    config: mockConfig,
  };

  // Default mock returns for happy path
  mockFindPreviousPostIds.mockResolvedValue(new Set());
  mockFetchStep.mockResolvedValue(makeFetchResult("typescript"));
  mockTriageStep.mockResolvedValue(makeTriageResult());
  mockSummarizeStep.mockResolvedValue(makeSummarizeResult());
  mockAssembleStep.mockResolvedValue(makeAssembleResult());
  mockPersistEvent.mockResolvedValue(undefined);
});

// --- Tests ---

describe("runDigestPipeline", () => {
  it("updates job status to RUNNING at start", async () => {
    await runDigestPipeline("job-1", [], deps);

    expect(mockDb.job.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "RUNNING", startedAt: expect.any(Date) },
    });
  });

  it("loads all active subreddits when no IDs specified", async () => {
    await runDigestPipeline("job-1", [], deps);

    expect(mockDb.subreddit.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
    });
  });

  it("loads subreddits by ID when subredditIds provided", async () => {
    await runDigestPipeline("job-1", ["sub-1", "sub-2"], deps);

    expect(mockDb.subreddit.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["sub-1", "sub-2"] }, isActive: true },
    });
  });

  it("calls fetchStep for each subreddit", async () => {
    const sub = makeSubreddit();
    mockDb.subreddit.findMany.mockResolvedValue([sub]);

    await runDigestPipeline("job-1", [], deps);

    expect(mockFetchStep).toHaveBeenCalledWith(
      { name: "typescript", maxPosts: 5, includeNsfw: false },
      mockContentSource,
      mockDb,
    );
  });

  it("filters out deduplicated posts", async () => {
    mockFindPreviousPostIds.mockResolvedValue(new Set(["reddit-1"]));

    const result = await runDigestPipeline("job-1", [], deps);

    // Post was deduped so triage should not be called
    expect(mockTriageStep).not.toHaveBeenCalled();
    // Subreddit result should have empty posts
    expect(result.subredditResults[0]).toBeDefined();
    expect(result.subredditResults[0]?.posts).toHaveLength(0);
  });

  it("calls triageStep with insight prompts (global + per-sub)", async () => {
    await runDigestPipeline("job-1", [], deps);

    expect(mockTriageStep).toHaveBeenCalledWith(
      [
        {
          index: 0,
          subreddit: "typescript",
          title: "Test Post 1",
          score: 100,
          numComments: 25,
          createdUtc: 1700000000,
          selftext: "Post body text",
        },
      ],
      ["global test prompt", "TypeScript and web development"],
      5,
      mockDb,
      "job-1",
      undefined,
      undefined,
    );
  });

  it("calls summarizeStep for each selected post", async () => {
    await runDigestPipeline("job-1", [], deps);

    expect(mockSummarizeStep).toHaveBeenCalledWith(
      {
        title: "Test Post 1",
        subreddit: "typescript",
        author: "testuser",
        score: 100,
        selftext: "Post body text",
      },
      [{ author: "commenter1", score: 10, body: "Great post!" }],
      ["global test prompt", "TypeScript and web development"],
      "job-1",
      "post-1",
      mockDb,
      undefined,
      "Highly relevant",
      undefined,
    );
  });

  it("calls assembleStep with all subreddit results", async () => {
    await runDigestPipeline("job-1", [], deps);

    expect(mockAssembleStep).toHaveBeenCalledWith(
      "job-1",
      [
        {
          subreddit: "typescript",
          posts: [
            {
              postId: "post-1",
              redditId: "reddit-1",
              title: "Test Post 1",
              summary: makeSummary(),
              selectionRationale: "Highly relevant",
            },
          ],
        },
      ],
      mockDb,
    );
  });

  it("emits PostsFetched, PostsTriaged, PostsSummarized events", async () => {
    await runDigestPipeline("job-1", [], deps);

    const persistedTypes = getPersistedEventTypes();
    expect(persistedTypes).toContain("PostsFetched");
    expect(persistedTypes).toContain("PostsTriaged");
    expect(persistedTypes).toContain("PostsSummarized");

    const emittedTypes = getEmittedEventTypes(mockEventBus);
    expect(emittedTypes).toContain("PostsFetched");
    expect(emittedTypes).toContain("PostsTriaged");
    expect(emittedTypes).toContain("PostsSummarized");
  });

  it("sets status to COMPLETED when all succeeds", async () => {
    const result = await runDigestPipeline("job-1", [], deps);

    expect(result.status).toBe("COMPLETED");
    expect(result.digestId).toBe("digest-1");
    expect(result.errors).toHaveLength(0);

    const lastData = getLastJobUpdate(mockDb);
    expect(lastData["status"]).toBe("COMPLETED");
    expect(lastData["completedAt"]).toBeInstanceOf(Date);
    expect(lastData["error"]).toBeNull();
  });

  it("emits DigestCompleted with digestId", async () => {
    await runDigestPipeline("job-1", [], deps);

    const payload = findPersistedEvent("DigestCompleted");
    expect(payload).toBeDefined();
    expect(payload?.["digestId"]).toBe("digest-1");
  });

  it("uses getModel when model config is provided", async () => {
    const modelConfig: ModelConfig = {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    };
    deps.model = modelConfig;
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test mock
    mockGetModel.mockReturnValue({} as ReturnType<typeof getModel>);

    await runDigestPipeline("job-1", [], deps);

    expect(mockGetModel).toHaveBeenCalledWith("triage", modelConfig);
    expect(mockGetModel).toHaveBeenCalledWith("summarize", modelConfig);
  });

  it("skips triage when all posts are deduped but still emits PostsFetched", async () => {
    mockFindPreviousPostIds.mockResolvedValue(new Set(["reddit-1"]));

    await runDigestPipeline("job-1", [], deps);

    const persistedTypes = getPersistedEventTypes();
    expect(persistedTypes).toContain("PostsFetched");

    expect(mockTriageStep).not.toHaveBeenCalled();
    expect(mockSummarizeStep).not.toHaveBeenCalled();
  });

  it("filters empty insight prompts", async () => {
    mockDb.config.findFirst.mockResolvedValue({ globalInsightPrompt: "" });
    mockDb.subreddit.findMany.mockResolvedValue([
      makeSubreddit({ insightPrompt: null }),
    ]);

    await runDigestPipeline("job-1", [], deps);

    expect(mockTriageStep).toHaveBeenCalledWith(
      expect.any(Array),
      [],
      5,
      mockDb,
      "job-1",
      undefined,
      undefined,
    );
  });
});

describe("error recovery - per subreddit", () => {
  it("skips failed subreddit and continues with others", async () => {
    const sub1 = makeSubreddit({ id: "sub-1", name: "typescript" });
    const sub2 = makeSubreddit({ id: "sub-2", name: "rust" });
    mockDb.subreddit.findMany.mockResolvedValue([sub1, sub2]);

    mockFetchStep
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(makeFetchResult("rust"));

    const result = await runDigestPipeline("job-1", [], deps);

    expect(result.subredditResults).toHaveLength(2);

    const first = result.subredditResults[0];
    const second = result.subredditResults[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.subreddit).toBe("typescript");
    expect(first?.error).toBe("Network error");
    expect(first?.posts).toHaveLength(0);
    expect(second?.subreddit).toBe("rust");
    expect(second?.posts).toHaveLength(1);
  });

  it("sets status to PARTIAL when some subreddits fail", async () => {
    const sub1 = makeSubreddit({ id: "sub-1", name: "typescript" });
    const sub2 = makeSubreddit({ id: "sub-2", name: "rust" });
    mockDb.subreddit.findMany.mockResolvedValue([sub1, sub2]);

    mockFetchStep
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(makeFetchResult("rust"));

    const result = await runDigestPipeline("job-1", [], deps);

    expect(result.status).toBe("PARTIAL");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("r/typescript");
  });

  it("includes error messages in result", async () => {
    const sub1 = makeSubreddit({ id: "sub-1", name: "typescript" });
    mockDb.subreddit.findMany.mockResolvedValue([sub1]);

    mockFetchStep.mockResolvedValue(makeFetchResult("typescript"));
    mockTriageStep.mockRejectedValue(new Error("LLM rate limited"));

    const result = await runDigestPipeline("job-1", [], deps);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("LLM rate limited");
    expect(result.errors[0]).toContain("r/typescript");
  });
});

describe("error recovery - per post", () => {
  it("skips failed summarization and continues with other posts", async () => {
    const fetchResult = makeFetchResult("typescript");
    const basePost = fetchResult.posts[0];
    expect(basePost).toBeDefined();
    fetchResult.posts.push({
      postId: "post-2",
      redditId: "reddit-2",
      post: {
        ...basePost?.post,
        id: "reddit-2",
        name: "t3_reddit2",
        subreddit: "typescript",
        title: "Test Post 2",
        selftext: "Post body text",
        author: "testuser",
        score: 100,
        num_comments: 25,
        url: "https://reddit.com/r/test/1",
        permalink: "/r/test/1",
        link_flair_text: null,
        over_18: false,
        created_utc: 1700000000,
        is_self: true,
      },
      comments: [],
    });
    mockFetchStep.mockResolvedValue(fetchResult);

    mockTriageStep.mockResolvedValue({
      selected: [
        { index: 0, relevanceScore: 8, rationale: "Relevant" },
        { index: 1, relevanceScore: 7, rationale: "Also relevant" },
      ],
    });

    mockSummarizeStep
      .mockRejectedValueOnce(new Error("Token limit exceeded"))
      .mockResolvedValueOnce(makeSummarizeResult());

    const result = await runDigestPipeline("job-1", [], deps);

    const subResult = result.subredditResults[0];
    expect(subResult).toBeDefined();
    expect(subResult?.posts).toHaveLength(1);
    expect(subResult?.posts[0]?.redditId).toBe("reddit-2");
  });

  it("sets status to PARTIAL when some posts fail", async () => {
    const fetchResult = makeFetchResult("typescript");
    const basePost = fetchResult.posts[0];
    expect(basePost).toBeDefined();
    fetchResult.posts.push({
      postId: "post-2",
      redditId: "reddit-2",
      post: {
        ...basePost?.post,
        id: "reddit-2",
        name: "t3_reddit2",
        subreddit: "typescript",
        title: "Test Post 2",
        selftext: "Post body text",
        author: "testuser",
        score: 100,
        num_comments: 25,
        url: "https://reddit.com/r/test/1",
        permalink: "/r/test/1",
        link_flair_text: null,
        over_18: false,
        created_utc: 1700000000,
        is_self: true,
      },
      comments: [],
    });
    mockFetchStep.mockResolvedValue(fetchResult);

    mockTriageStep.mockResolvedValue({
      selected: [
        { index: 0, relevanceScore: 8, rationale: "Relevant" },
        { index: 1, relevanceScore: 7, rationale: "Also relevant" },
      ],
    });

    mockSummarizeStep
      .mockRejectedValueOnce(new Error("Token limit exceeded"))
      .mockResolvedValueOnce(makeSummarizeResult());

    const result = await runDigestPipeline("job-1", [], deps);

    expect(result.status).toBe("PARTIAL");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("reddit-1");
    expect(result.errors[0]).toContain("Token limit exceeded");
  });
});

describe("error recovery - total failure", () => {
  it("sets status to FAILED when zero content produced", async () => {
    mockDb.subreddit.findMany.mockResolvedValue([makeSubreddit()]);
    mockFetchStep.mockRejectedValue(new Error("Reddit API down"));

    const result = await runDigestPipeline("job-1", [], deps);

    expect(result.status).toBe("FAILED");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("emits DigestFailed event", async () => {
    mockDb.subreddit.findMany.mockResolvedValue([makeSubreddit()]);
    mockFetchStep.mockRejectedValue(new Error("Reddit API down"));

    await runDigestPipeline("job-1", [], deps);

    const payload = findPersistedEvent("DigestFailed");
    expect(payload).toBeDefined();
    expect(String(payload?.["error"])).toContain("Reddit API down");
  });

  it("does NOT call assembleStep", async () => {
    mockDb.subreddit.findMany.mockResolvedValue([makeSubreddit()]);
    mockFetchStep.mockRejectedValue(new Error("Reddit API down"));

    await runDigestPipeline("job-1", [], deps);

    expect(mockAssembleStep).not.toHaveBeenCalled();
  });

  it("updates job to FAILED with error message", async () => {
    mockDb.subreddit.findMany.mockResolvedValue([makeSubreddit()]);
    mockFetchStep.mockRejectedValue(new Error("Reddit API down"));

    await runDigestPipeline("job-1", [], deps);

    const lastData = getLastJobUpdate(mockDb);
    expect(lastData["status"]).toBe("FAILED");
    expect(String(lastData["error"])).toContain("Reddit API down");
    expect(lastData["completedAt"]).toBeInstanceOf(Date);
  });

  it("sets status to FAILED when no subreddits are active", async () => {
    mockDb.subreddit.findMany.mockResolvedValue([]);

    const result = await runDigestPipeline("job-1", [], deps);

    expect(result.status).toBe("FAILED");
    expect(mockAssembleStep).not.toHaveBeenCalled();
  });
});

describe("error recovery - unhandled exceptions (issue #3)", () => {
  it("marks job as FAILED when assembleStep throws", async () => {
    mockAssembleStep.mockRejectedValue(new Error("DB write failed"));

    const result = await runDigestPipeline("job-1", [], deps);

    expect(result.status).toBe("FAILED");
    const lastData = getLastJobUpdate(mockDb);
    expect(lastData["status"]).toBe("FAILED");
    expect(String(lastData["error"])).toContain("DB write failed");
    expect(lastData["completedAt"]).toBeInstanceOf(Date);
  });

  it("marks job as FAILED when subreddit.findMany throws", async () => {
    mockDb.subreddit.findMany.mockRejectedValue(
      new Error("Connection refused"),
    );

    const result = await runDigestPipeline("job-1", [], deps);

    expect(result.status).toBe("FAILED");
    const lastData = getLastJobUpdate(mockDb);
    expect(lastData["status"]).toBe("FAILED");
    expect(String(lastData["error"])).toContain("Connection refused");
  });

  it("marks job as FAILED when config.findFirst throws", async () => {
    mockDb.config.findFirst.mockRejectedValue(new Error("Config table gone"));

    const result = await runDigestPipeline("job-1", [], deps);

    expect(result.status).toBe("FAILED");
    const lastData = getLastJobUpdate(mockDb);
    expect(lastData["status"]).toBe("FAILED");
    expect(String(lastData["error"])).toContain("Config table gone");
  });

  it("emits DigestFailed event on unhandled exception", async () => {
    mockAssembleStep.mockRejectedValue(new Error("Unexpected crash"));

    await runDigestPipeline("job-1", [], deps);

    const payload = findPersistedEvent("DigestFailed");
    expect(payload).toBeDefined();
    expect(String(payload?.["error"])).toContain("Unexpected crash");
  });

  it("still returns a PipelineResult even on unhandled exceptions", async () => {
    mockAssembleStep.mockRejectedValue(new Error("Crash"));

    const result = await runDigestPipeline("job-1", [], deps);

    expect(result).toHaveProperty("jobId", "job-1");
    expect(result).toHaveProperty("status", "FAILED");
    expect(result).toHaveProperty("errors");
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
