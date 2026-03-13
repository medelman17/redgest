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
  mockWireDigestDispatch,
  mockCommandHandlers,
  mockQueryHandlers,
  mockContentSourceInstance,
  mockCreateContentSource,
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

  const mockWireDigestDispatch = vi.fn();
  const mockCommandHandlers = { GenerateDigest: vi.fn() };
  const mockQueryHandlers = { GetDigest: vi.fn() };

  const mockContentSourceInstance = { fetchContent: vi.fn() };
  const mockCreateContentSource = vi.fn().mockReturnValue(mockContentSourceInstance);

  return {
    mockLoadConfig,
    mockPrismaClient,
    mockExecute,
    mockCreateExecute,
    mockQuery,
    mockCreateQuery,
    mockEventBusInstance,
    MockDomainEventBus,
    mockWireDigestDispatch,
    mockCommandHandlers,
    mockQueryHandlers,
    mockContentSourceInstance,
    mockCreateContentSource,
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
  wireDigestDispatch: mockWireDigestDispatch,
  recordDeliveryPending: vi.fn(),
  recordDeliveryResult: vi.fn(),
  commandHandlers: mockCommandHandlers,
  queryHandlers: mockQueryHandlers,
}));

vi.mock("@redgest/reddit", () => ({
  createContentSource: mockCreateContentSource,
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

  it("creates command dispatcher from commandHandlers registry", async () => {
    await bootstrap();
    expect(mockCreateExecute).toHaveBeenCalledWith(mockCommandHandlers);
  });

  it("creates query dispatcher from queryHandlers registry", async () => {
    await bootstrap();
    expect(mockCreateQuery).toHaveBeenCalledWith(mockQueryHandlers);
  });

  it("calls createContentSource with Reddit credentials from config", async () => {
    await bootstrap();
    expect(mockCreateContentSource).toHaveBeenCalledWith({
      clientId: "reddit-id",
      clientSecret: "reddit-secret",
    });
  });

  it("calls wireDigestDispatch with eventBus, pipelineDeps, triggerSecretKey, and deliverDigest", async () => {
    await bootstrap();
    expect(mockWireDigestDispatch).toHaveBeenCalledWith({
      eventBus: mockEventBusInstance,
      pipelineDeps: {
        db: mockPrismaClient,
        eventBus: mockEventBusInstance,
        contentSource: mockContentSourceInstance,
        config: fakeConfig,
      },
      triggerSecretKey: "tr_test",
      deliverDigest: expect.any(Function),
    });
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

    it("passes undefined triggerSecretKey to wireDigestDispatch", async () => {
      await bootstrap();
      expect(mockWireDigestDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          triggerSecretKey: undefined,
        }),
      );
    });
  });
});
