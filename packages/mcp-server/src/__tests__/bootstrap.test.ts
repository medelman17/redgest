import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock values (accessible in vi.mock factories) ─────────────
const {
  mockLoadConfig,
  mockPrismaClient,
  mockExecute,
  mockCreateExecute,
  mockQuery,
  mockCreateQuery,
  mockEventBusInstance,
  MockDomainEventBus,
  mockRunDigestPipeline,
  mockCommandHandlers,
  mockQueryHandlers,
  mockRedditClientInstance,
  MockRedditClient,
  mockTokenBucketInstance,
  MockTokenBucket,
  mockContentSourceInstance,
  MockRedditContentSource,
  mockTasksTrigger,
} = vi.hoisted(() => {
  const mockLoadConfig = vi.fn();

  const mockPrismaClient = {
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $transaction: vi.fn(),
  };

  const mockExecute = vi.fn();
  const mockCreateExecute = vi.fn().mockReturnValue(mockExecute);
  const mockQuery = vi.fn();
  const mockCreateQuery = vi.fn().mockReturnValue(mockQuery);

  const mockEventBusInstance = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    emitEvent: vi.fn(),
  };
  // Use function keyword so it can be called with `new`
  const MockDomainEventBus = vi.fn(function () {
    return mockEventBusInstance;
  });

  const mockRunDigestPipeline = vi.fn();
  const mockCommandHandlers = { GenerateDigest: vi.fn() };
  const mockQueryHandlers = { GetDigest: vi.fn() };

  const mockRedditClientInstance = { authenticate: vi.fn() };
  const MockRedditClient = vi.fn(function () {
    return mockRedditClientInstance;
  });

  const mockTokenBucketInstance = { acquire: vi.fn() };
  const MockTokenBucket = vi.fn(function () {
    return mockTokenBucketInstance;
  });

  const mockContentSourceInstance = { fetchContent: vi.fn() };
  const MockRedditContentSource = vi.fn(function () {
    return mockContentSourceInstance;
  });

  const mockTasksTrigger = vi.fn();

  return {
    mockLoadConfig,
    mockPrismaClient,
    mockExecute,
    mockCreateExecute,
    mockQuery,
    mockCreateQuery,
    mockEventBusInstance,
    MockDomainEventBus,
    mockRunDigestPipeline,
    mockCommandHandlers,
    mockQueryHandlers,
    mockRedditClientInstance,
    MockRedditClient,
    mockTokenBucketInstance,
    MockTokenBucket,
    mockContentSourceInstance,
    MockRedditContentSource,
    mockTasksTrigger,
  };
});

// ── Module mocks ──────────────────────────────────────────────────────
vi.mock("@redgest/config", () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock("@redgest/db", () => ({
  prisma: mockPrismaClient,
}));

vi.mock("@redgest/core", () => ({
  createExecute: mockCreateExecute,
  createQuery: mockCreateQuery,
  DomainEventBus: MockDomainEventBus,
  runDigestPipeline: mockRunDigestPipeline,
  commandHandlers: mockCommandHandlers,
  queryHandlers: mockQueryHandlers,
}));

vi.mock("@redgest/reddit", () => ({
  RedditClient: MockRedditClient,
  TokenBucket: MockTokenBucket,
  RedditContentSource: MockRedditContentSource,
}));

vi.mock("@trigger.dev/sdk/v3", () => ({
  tasks: { trigger: mockTasksTrigger },
}));

// ── Import under test (after mocks) ──────────────────────────────────
import { bootstrap } from "../bootstrap.js";

describe("bootstrap()", () => {
  const fakeConfig = {
    DATABASE_URL: "postgresql://localhost/test",
    ANTHROPIC_API_KEY: "sk-test",
    TRIGGER_SECRET_KEY: "tr_test",
    MCP_SERVER_API_KEY: "a".repeat(32),
    MCP_SERVER_PORT: 3100,
    REDDIT_CLIENT_ID: "reddit-id",
    REDDIT_CLIENT_SECRET: "reddit-secret",
    LOG_LEVEL: "info" as const,
    NODE_ENV: "test" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue(fakeConfig);
  });

  it("loads config via loadConfig()", async () => {
    await bootstrap();
    expect(mockLoadConfig).toHaveBeenCalledOnce();
  });

  it("creates a DomainEventBus", async () => {
    await bootstrap();
    expect(MockDomainEventBus).toHaveBeenCalledOnce();
  });

  it("registers DigestRequested event handler on the event bus", async () => {
    await bootstrap();
    expect(mockEventBusInstance.on).toHaveBeenCalledWith(
      "DigestRequested",
      expect.any(Function),
    );
  });

  it("creates command dispatcher from commandHandlers registry", async () => {
    await bootstrap();
    expect(mockCreateExecute).toHaveBeenCalledWith(mockCommandHandlers);
  });

  it("creates query dispatcher from queryHandlers registry", async () => {
    await bootstrap();
    expect(mockCreateQuery).toHaveBeenCalledWith(mockQueryHandlers);
  });

  it("creates RedditClient with config credentials", async () => {
    await bootstrap();
    expect(MockRedditClient).toHaveBeenCalledWith({
      clientId: "reddit-id",
      clientSecret: "reddit-secret",
      userAgent: "redgest/1.0.0",
    });
  });

  it("creates TokenBucket with 60 req/min (capacity 60, refillRate 1)", async () => {
    await bootstrap();
    expect(MockTokenBucket).toHaveBeenCalledWith({
      capacity: 60,
      refillRate: 1,
    });
  });

  it("creates RedditContentSource with client and rate limiter", async () => {
    await bootstrap();
    expect(MockRedditContentSource).toHaveBeenCalledWith(
      mockRedditClientInstance,
      mockTokenBucketInstance,
    );
  });

  it("returns execute, query, ctx, config, and db", async () => {
    const result = await bootstrap();

    expect(result.execute).toBe(mockExecute);
    expect(result.query).toBe(mockQuery);
    expect(result.config).toBe(fakeConfig);
    expect(result.db).toBe(mockPrismaClient);
    expect(result.ctx).toEqual({
      db: mockPrismaClient,
      eventBus: mockEventBusInstance,
      config: fakeConfig,
    });
  });

  it("DigestRequested handler dispatches via Trigger.dev when TRIGGER_SECRET_KEY is set", async () => {
    await bootstrap();

    const onCall = mockEventBusInstance.on.mock.calls.find(
      (call: unknown[]) => call[0] === "DigestRequested",
    );
    expect(onCall).toBeDefined();
    if (!onCall) throw new Error("unreachable");

    const handler = onCall[1] as (event: {
      type: "DigestRequested";
      payload: { jobId: string; subredditIds: string[] };
    }) => Promise<void>;

    await handler({
      type: "DigestRequested",
      payload: { jobId: "job-123", subredditIds: ["sub-1", "sub-2"] },
    });

    expect(mockTasksTrigger).toHaveBeenCalledWith("generate-digest", {
      jobId: "job-123",
      subredditIds: ["sub-1", "sub-2"],
    });
    expect(mockRunDigestPipeline).not.toHaveBeenCalled();
  });

  it("DigestRequested handler falls back to in-process when Trigger.dev dispatch fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockTasksTrigger.mockRejectedValueOnce(new Error("dispatch failed"));

    await bootstrap();

    const onCall = mockEventBusInstance.on.mock.calls.find(
      (call: unknown[]) => call[0] === "DigestRequested",
    );
    expect(onCall).toBeDefined();
    if (!onCall) throw new Error("unreachable");

    const handler = onCall[1] as (event: {
      type: "DigestRequested";
      payload: { jobId: string; subredditIds: string[] };
    }) => Promise<void>;

    await handler({
      type: "DigestRequested",
      payload: { jobId: "job-123", subredditIds: ["sub-1", "sub-2"] },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("dispatch failed"),
    );
    expect(mockRunDigestPipeline).toHaveBeenCalledWith(
      "job-123",
      ["sub-1", "sub-2"],
      {
        db: mockPrismaClient,
        eventBus: mockEventBusInstance,
        contentSource: mockContentSourceInstance,
        config: fakeConfig,
      },
    );
    consoleSpy.mockRestore();
  });

  it("DigestRequested handler catches fallback pipeline errors without throwing", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockTasksTrigger.mockRejectedValueOnce(new Error("dispatch failed"));
    mockRunDigestPipeline.mockRejectedValueOnce(new Error("pipeline boom"));

    await bootstrap();

    const onCall = mockEventBusInstance.on.mock.calls.find(
      (call: unknown[]) => call[0] === "DigestRequested",
    );
    expect(onCall).toBeDefined();
    if (!onCall) throw new Error("unreachable");

    const handler = onCall[1] as (event: {
      type: "DigestRequested";
      payload: { jobId: string; subredditIds: string[] };
    }) => Promise<void>;

    // Should not throw
    await handler({
      type: "DigestRequested",
      payload: { jobId: "job-fail", subredditIds: [] },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("pipeline boom"),
    );
    consoleSpy.mockRestore();
  });

  describe("without TRIGGER_SECRET_KEY", () => {
    const configWithoutTrigger = {
      DATABASE_URL: "postgresql://localhost/test",
      ANTHROPIC_API_KEY: "sk-test",
      MCP_SERVER_API_KEY: "a".repeat(32),
      MCP_SERVER_PORT: 3100,
      REDDIT_CLIENT_ID: "reddit-id",
      REDDIT_CLIENT_SECRET: "reddit-secret",
      LOG_LEVEL: "info" as const,
      NODE_ENV: "test" as const,
    };

    beforeEach(() => {
      mockLoadConfig.mockReturnValue(configWithoutTrigger);
    });

    it("DigestRequested handler calls runDigestPipeline directly", async () => {
      await bootstrap();

      const onCall = mockEventBusInstance.on.mock.calls.find(
        (call: unknown[]) => call[0] === "DigestRequested",
      );
      expect(onCall).toBeDefined();
      if (!onCall) throw new Error("unreachable");

      const handler = onCall[1] as (event: {
        type: "DigestRequested";
        payload: { jobId: string; subredditIds: string[] };
      }) => Promise<void>;

      await handler({
        type: "DigestRequested",
        payload: { jobId: "job-123", subredditIds: ["sub-1", "sub-2"] },
      });

      expect(mockRunDigestPipeline).toHaveBeenCalledWith(
        "job-123",
        ["sub-1", "sub-2"],
        {
          db: mockPrismaClient,
          eventBus: mockEventBusInstance,
          contentSource: mockContentSourceInstance,
          config: configWithoutTrigger,
        },
      );
      expect(mockTasksTrigger).not.toHaveBeenCalled();
    });

    it("DigestRequested handler catches pipeline errors without throwing", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRunDigestPipeline.mockRejectedValueOnce(new Error("pipeline boom"));

      await bootstrap();

      const onCall = mockEventBusInstance.on.mock.calls.find(
        (call: unknown[]) => call[0] === "DigestRequested",
      );
      expect(onCall).toBeDefined();
      if (!onCall) throw new Error("unreachable");

      const handler = onCall[1] as (event: {
        type: "DigestRequested";
        payload: { jobId: string; subredditIds: string[] };
      }) => Promise<void>;

      await handler({
        type: "DigestRequested",
        payload: { jobId: "job-fail", subredditIds: [] },
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("pipeline boom"),
      );
      consoleSpy.mockRestore();
    });
  });
});
