import { describe, it, expect, vi } from "vitest";
import { DomainEventBus } from "../events/bus.js";
import type { HandlerContext } from "../context.js";
import { handleGenerateDigest } from "../commands/handlers/generate-digest.js";
import { handleAddSubreddit } from "../commands/handlers/add-subreddit.js";
import { handleRemoveSubreddit } from "../commands/handlers/remove-subreddit.js";
import { handleUpdateSubreddit } from "../commands/handlers/update-subreddit.js";
import { handleUpdateConfig } from "../commands/handlers/update-config.js";
import { commandHandlers } from "../commands/handlers/index.js";

/** Cast helper to avoid objectLiteralTypeAssertions lint rule on `{} as T`. */
function stub<T>(): T {
  const empty = {};
  return empty as T;
}

function makeCtx(dbMock: Record<string, unknown>): HandlerContext {
  const db = dbMock;
  return {
    db: db as unknown as HandlerContext["db"],
    eventBus: new DomainEventBus(),
    config: stub<HandlerContext["config"]>(),
  };
}

describe("handleGenerateDigest", () => {
  it("creates a job with QUEUED status and returns jobId", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: "job-123",
      status: "QUEUED",
    });
    const ctx = makeCtx({ job: { create: mockCreate } });

    const result = await handleGenerateDigest(
      { subredditIds: ["sub-1", "sub-2"], lookbackHours: 48 },
      ctx,
    );

    expect(result.data).toEqual({ jobId: "job-123", status: "QUEUED" });
    expect(result.event).toEqual({
      jobId: "job-123",
      subredditIds: ["sub-1", "sub-2"],
    });
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        status: "QUEUED",
        subreddits: ["sub-1", "sub-2"],
        lookback: "48h",
      },
    });
  });

  it("uses defaults when no params provided", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: "job-456",
      status: "QUEUED",
    });
    const ctx = makeCtx({ job: { create: mockCreate } });

    const result = await handleGenerateDigest({}, ctx);

    expect(result.data).toEqual({ jobId: "job-456", status: "QUEUED" });
    expect(result.event).toEqual({ jobId: "job-456", subredditIds: [] });
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        status: "QUEUED",
        subreddits: [],
        lookback: "24h",
      },
    });
  });
});

describe("handleAddSubreddit", () => {
  it("creates a subreddit and emits SubredditAdded event", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: "sub-abc",
      name: "typescript",
    });
    const ctx = makeCtx({ subreddit: { create: mockCreate } });

    const result = await handleAddSubreddit(
      { name: "typescript", displayName: "TypeScript" },
      ctx,
    );

    expect(result.data).toEqual({ subredditId: "sub-abc" });
    expect(result.event).toEqual({
      subredditId: "sub-abc",
      name: "typescript",
    });
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        name: "typescript",
        insightPrompt: null,
        maxPosts: 5,
        includeNsfw: false,
      },
    });
  });

  it("passes optional fields when provided", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: "sub-xyz",
      name: "rust",
    });
    const ctx = makeCtx({ subreddit: { create: mockCreate } });

    const result = await handleAddSubreddit(
      {
        name: "rust",
        displayName: "Rust",
        insightPrompt: "Focus on async patterns",
        maxPosts: 10,
        nsfw: true,
      },
      ctx,
    );

    expect(result.data).toEqual({ subredditId: "sub-xyz" });
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        name: "rust",
        insightPrompt: "Focus on async patterns",
        maxPosts: 10,
        includeNsfw: true,
      },
    });
  });
});

describe("handleRemoveSubreddit", () => {
  it("soft-deletes by setting isActive to false", async () => {
    const mockUpdate = vi.fn().mockResolvedValue({
      id: "sub-del",
      name: "oldsubreddit",
    });
    const ctx = makeCtx({ subreddit: { update: mockUpdate } });

    const result = await handleRemoveSubreddit(
      { subredditId: "sub-del" },
      ctx,
    );

    expect(result.data).toEqual({ subredditId: "sub-del" });
    expect(result.event).toEqual({
      subredditId: "sub-del",
      name: "oldsubreddit",
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "sub-del" },
      data: { isActive: false },
      select: { id: true, name: true },
    });
  });
});

describe("handleUpdateSubreddit", () => {
  it("updates provided fields and returns null event", async () => {
    const mockUpdate = vi.fn().mockResolvedValue({ id: "sub-upd" });
    const ctx = makeCtx({ subreddit: { update: mockUpdate } });

    const result = await handleUpdateSubreddit(
      { subredditId: "sub-upd", insightPrompt: "new prompt", maxPosts: 15 },
      ctx,
    );

    expect(result.data).toEqual({ subredditId: "sub-upd" });
    expect(result.event).toBeNull();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "sub-upd" },
      data: { insightPrompt: "new prompt", maxPosts: 15 },
    });
  });

  it("maps active param to isActive field", async () => {
    const mockUpdate = vi.fn().mockResolvedValue({ id: "sub-upd" });
    const ctx = makeCtx({ subreddit: { update: mockUpdate } });

    await handleUpdateSubreddit(
      { subredditId: "sub-upd", active: false },
      ctx,
    );

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "sub-upd" },
      data: { isActive: false },
    });
  });

  it("sends empty data object when no optional fields provided", async () => {
    const mockUpdate = vi.fn().mockResolvedValue({ id: "sub-upd" });
    const ctx = makeCtx({ subreddit: { update: mockUpdate } });

    await handleUpdateSubreddit({ subredditId: "sub-upd" }, ctx);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "sub-upd" },
      data: {},
    });
  });
});

describe("handleUpdateConfig", () => {
  it("upserts config with provided fields", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ id: 1 });
    const ctx = makeCtx({ config: { upsert: mockUpsert } });

    const result = await handleUpdateConfig(
      { globalInsightPrompt: "new prompt", llmModel: "gpt-4.1" },
      ctx,
    );

    expect(result.data).toEqual({ success: true });
    expect(result.event).toEqual({
      changes: { globalInsightPrompt: "new prompt", llmModel: "gpt-4.1" },
    });
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { id: 1 },
      update: { globalInsightPrompt: "new prompt", llmModel: "gpt-4.1" },
      create: {
        id: 1,
        globalInsightPrompt: "new prompt",
        llmProvider: "anthropic",
        llmModel: "gpt-4.1",
      },
    });
  });

  it("converts defaultLookbackHours to string format", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ id: 1 });
    const ctx = makeCtx({ config: { upsert: mockUpsert } });

    const result = await handleUpdateConfig(
      { defaultLookbackHours: 48 },
      ctx,
    );

    expect(result.event).toEqual({
      changes: { defaultLookback: "48h" },
    });
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { id: 1 },
      update: { defaultLookback: "48h" },
      create: {
        id: 1,
        globalInsightPrompt: "",
        llmProvider: "anthropic",
        llmModel: "claude-sonnet-4-20250514",
      },
    });
  });

  it("uses defaults for create when no fields match create columns", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ id: 1 });
    const ctx = makeCtx({ config: { upsert: mockUpsert } });

    await handleUpdateConfig({}, ctx);

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        globalInsightPrompt: "",
        llmProvider: "anthropic",
        llmModel: "claude-sonnet-4-20250514",
      },
    });
  });
});

describe("commandHandlers registry", () => {
  it("registers all 5 handlers", () => {
    expect(commandHandlers.GenerateDigest).toBe(handleGenerateDigest);
    expect(commandHandlers.AddSubreddit).toBe(handleAddSubreddit);
    expect(commandHandlers.RemoveSubreddit).toBe(handleRemoveSubreddit);
    expect(commandHandlers.UpdateSubreddit).toBe(handleUpdateSubreddit);
    expect(commandHandlers.UpdateConfig).toBe(handleUpdateConfig);
  });
});
