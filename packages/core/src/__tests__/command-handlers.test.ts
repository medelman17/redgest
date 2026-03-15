import { describe, it, expect, vi } from "vitest";
import { DomainEventBus } from "../events/bus.js";
import type { HandlerContext } from "../context.js";
import { RedgestError } from "../errors.js";
import { handleGenerateDigest } from "../commands/handlers/generate-digest.js";
import { handleAddSubreddit } from "../commands/handlers/add-subreddit.js";
import { handleRemoveSubreddit } from "../commands/handlers/remove-subreddit.js";
import { handleUpdateSubreddit } from "../commands/handlers/update-subreddit.js";
import { handleUpdateConfig } from "../commands/handlers/update-config.js";
import { handleCancelRun } from "../commands/handlers/cancel-run.js";
import { handleCreateProfile } from "../commands/handlers/create-profile.js";
import { handleUpdateProfile } from "../commands/handlers/update-profile.js";
import { handleDeleteProfile } from "../commands/handlers/delete-profile.js";
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
    organizationId: "org_test",
  };
}

describe("handleGenerateDigest", () => {
  it("creates a job with QUEUED status and returns jobId", async () => {
    const mockFindFirst = vi.fn().mockResolvedValue(null);
    const mockCreate = vi.fn().mockResolvedValue({
      id: "job-123",
      status: "QUEUED",
    });
    const ctx = makeCtx({ job: { findFirst: mockFindFirst, create: mockCreate } });

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
        organizationId: "org_test",
        status: "QUEUED",
        subreddits: ["sub-1", "sub-2"],
        lookback: "48h",
        profileId: null,
      },
    });
  });

  it("uses defaults when no params provided", async () => {
    const mockFindFirst = vi.fn().mockResolvedValue(null);
    const mockCreate = vi.fn().mockResolvedValue({
      id: "job-456",
      status: "QUEUED",
    });
    const ctx = makeCtx({ job: { findFirst: mockFindFirst, create: mockCreate } });

    const result = await handleGenerateDigest({}, ctx);

    expect(result.data).toEqual({ jobId: "job-456", status: "QUEUED" });
    expect(result.event).toEqual({ jobId: "job-456", subredditIds: [] });
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org_test",
        status: "QUEUED",
        subreddits: [],
        lookback: "24h",
        profileId: null,
      },
    });
  });

  it("rejects with CONFLICT when a job is already active", async () => {
    const mockFindFirst = vi.fn().mockResolvedValue({
      id: "active-job",
      status: "RUNNING",
      createdAt: new Date(),
    });
    const mockCreate = vi.fn();
    const ctx = makeCtx({ job: { findFirst: mockFindFirst, create: mockCreate } });

    await expect(
      handleGenerateDigest({ subredditIds: ["sub-1"] }, ctx),
    ).rejects.toThrow(RedgestError);

    await expect(
      handleGenerateDigest({ subredditIds: ["sub-1"] }, ctx),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(mockCreate).not.toHaveBeenCalled();
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
        organizationId: "org_test",
        insightPrompt: null,
        maxPosts: 5,
        includeNsfw: false,
        nextCrawlAt: expect.any(Date),
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
        organizationId: "org_test",
        insightPrompt: "Focus on async patterns",
        maxPosts: 10,
        includeNsfw: true,
        nextCrawlAt: expect.any(Date),
      },
    });
  });
});

describe("handleRemoveSubreddit", () => {
  it("deletes the subreddit record and emits event", async () => {
    const mockFindFirst = vi.fn().mockResolvedValue({ id: "sub-del" });
    const mockDelete = vi.fn().mockResolvedValue({
      id: "sub-del",
      name: "oldsubreddit",
    });
    const ctx = makeCtx({ subreddit: { findFirst: mockFindFirst, delete: mockDelete } });

    const result = await handleRemoveSubreddit(
      { subredditId: "sub-del" },
      ctx,
    );

    expect(result.data).toEqual({ subredditId: "sub-del" });
    expect(result.event).toEqual({
      subredditId: "sub-del",
      name: "oldsubreddit",
    });
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { id: "sub-del", organizationId: "org_test" },
      select: { id: true },
    });
    expect(mockDelete).toHaveBeenCalledWith({
      where: { id: "sub-del" },
      select: { id: true, name: true },
    });
  });
});

describe("handleUpdateSubreddit", () => {
  it("updates provided fields and returns null event", async () => {
    const mockFindFirst = vi.fn().mockResolvedValue({ id: "sub-upd" });
    const mockUpdate = vi.fn().mockResolvedValue({ id: "sub-upd" });
    const ctx = makeCtx({ subreddit: { findFirst: mockFindFirst, update: mockUpdate } });

    const result = await handleUpdateSubreddit(
      { subredditId: "sub-upd", insightPrompt: "new prompt", maxPosts: 15 },
      ctx,
    );

    expect(result.data).toEqual({ subredditId: "sub-upd" });
    expect(result.event).toBeNull();
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { id: "sub-upd", organizationId: "org_test" },
      select: { id: true },
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "sub-upd" },
      data: { insightPrompt: "new prompt", maxPosts: 15 },
    });
  });

  it("maps active param to isActive field", async () => {
    const mockFindFirst = vi.fn().mockResolvedValue({ id: "sub-upd" });
    const mockUpdate = vi.fn().mockResolvedValue({ id: "sub-upd" });
    const ctx = makeCtx({ subreddit: { findFirst: mockFindFirst, update: mockUpdate } });

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
    const mockFindFirst = vi.fn().mockResolvedValue({ id: "sub-upd" });
    const mockUpdate = vi.fn().mockResolvedValue({ id: "sub-upd" });
    const ctx = makeCtx({ subreddit: { findFirst: mockFindFirst, update: mockUpdate } });

    await handleUpdateSubreddit({ subredditId: "sub-upd" }, ctx);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "sub-upd" },
      data: {},
    });
  });

  it("maps crawlIntervalMinutes param", async () => {
    const mockFindFirst = vi.fn().mockResolvedValue({ id: "sub-upd" });
    const mockUpdate = vi.fn().mockResolvedValue({ id: "sub-upd" });
    const ctx = makeCtx({ subreddit: { findFirst: mockFindFirst, update: mockUpdate } });

    await handleUpdateSubreddit(
      { subredditId: "sub-upd", crawlIntervalMinutes: 60 },
      ctx,
    );

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "sub-upd" },
      data: { crawlIntervalMinutes: 60 },
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
      where: { organizationId: "org_test" },
      update: { globalInsightPrompt: "new prompt", llmModel: "gpt-4.1" },
      create: expect.objectContaining({
        organizationId: "org_test",
        globalInsightPrompt: "new prompt",
        llmProvider: "anthropic",
        llmModel: "gpt-4.1",
      }),
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
      where: { organizationId: "org_test" },
      update: { defaultLookback: "48h" },
      create: {
        organizationId: "org_test",
        globalInsightPrompt: "",
        llmProvider: "anthropic",
        llmModel: "claude-sonnet-4-20250514",
        defaultLookback: "48h",
      },
    });
  });

  it("uses defaults for create when no fields match create columns", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ id: 1 });
    const ctx = makeCtx({ config: { upsert: mockUpsert } });

    await handleUpdateConfig({}, ctx);

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { organizationId: "org_test" },
      update: {},
      create: {
        organizationId: "org_test",
        globalInsightPrompt: "",
        llmProvider: "anthropic",
        llmModel: "claude-sonnet-4-20250514",
      },
    });
  });

  it("passes defaultDelivery to upsert", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ id: 1 });
    const ctx = makeCtx({ config: { upsert: mockUpsert } });

    const result = await handleUpdateConfig(
      { defaultDelivery: "EMAIL" as import("@redgest/db").DeliveryChannel },
      ctx,
    );

    expect(result.event).toEqual({
      changes: { defaultDelivery: "EMAIL" },
    });
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { organizationId: "org_test" },
      update: { defaultDelivery: "EMAIL" },
      create: expect.objectContaining({
        organizationId: "org_test",
        defaultDelivery: "EMAIL",
      }),
    });
  });

  it("passes schedule (including null to disable) to upsert", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ id: 1 });
    const ctx = makeCtx({ config: { upsert: mockUpsert } });

    const result = await handleUpdateConfig(
      { schedule: "0 7 * * *" },
      ctx,
    );

    expect(result.event).toEqual({
      changes: { schedule: "0 7 * * *" },
    });

    // Test null (disable schedule)
    await handleUpdateConfig({ schedule: null }, ctx);
    expect(mockUpsert).toHaveBeenLastCalledWith({
      where: { organizationId: "org_test" },
      update: { schedule: null },
      create: expect.objectContaining({ organizationId: "org_test", schedule: null }),
    });
  });
});

describe("handleCancelRun", () => {
  it("cancels a QUEUED job", async () => {
    const mockFindFirst = vi.fn().mockResolvedValue({
      id: "job-1",
      status: "QUEUED",
      triggerRunId: null,
    });
    const mockUpdate = vi.fn().mockResolvedValue({ id: "job-1" });
    const ctx = makeCtx({ job: { findFirst: mockFindFirst, update: mockUpdate } });

    const result = await handleCancelRun({ jobId: "job-1" }, ctx);

    expect(result.data).toEqual({ jobId: "job-1", status: "CANCELED" });
    expect(result.event).toEqual({ jobId: "job-1" });
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { id: "job-1", organizationId: "org_test" },
      select: { id: true, status: true, triggerRunId: true },
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "CANCELED",
        completedAt: expect.any(Date),
        error: "Canceled by user",
      },
    });
  });

  it("cancels a RUNNING job", async () => {
    const mockFindFirst = vi.fn().mockResolvedValue({
      id: "job-2",
      status: "RUNNING",
      triggerRunId: null,
    });
    const mockUpdate = vi.fn().mockResolvedValue({ id: "job-2" });
    const ctx = makeCtx({ job: { findFirst: mockFindFirst, update: mockUpdate } });

    const result = await handleCancelRun({ jobId: "job-2" }, ctx);

    expect(result.data).toEqual({ jobId: "job-2", status: "CANCELED" });
    expect(result.event).toEqual({ jobId: "job-2" });
  });

  it("throws NOT_FOUND when job does not exist", async () => {
    const mockFindFirst = vi.fn().mockResolvedValue(null);
    const ctx = makeCtx({ job: { findFirst: mockFindFirst } });

    await expect(
      handleCancelRun({ jobId: "nonexistent" }, ctx),
    ).rejects.toThrow(RedgestError);

    await expect(
      handleCancelRun({ jobId: "nonexistent" }, ctx),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws CONFLICT when job is already COMPLETED", async () => {
    const mockFindFirst = vi.fn().mockResolvedValue({
      id: "job-3",
      status: "COMPLETED",
      triggerRunId: null,
    });
    const ctx = makeCtx({ job: { findFirst: mockFindFirst } });

    await expect(
      handleCancelRun({ jobId: "job-3" }, ctx),
    ).rejects.toThrow(RedgestError);

    await expect(
      handleCancelRun({ jobId: "job-3" }, ctx),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("throws CONFLICT when job is already CANCELED", async () => {
    const mockFindFirst = vi.fn().mockResolvedValue({
      id: "job-4",
      status: "CANCELED",
      triggerRunId: null,
    });
    const ctx = makeCtx({ job: { findFirst: mockFindFirst } });

    await expect(
      handleCancelRun({ jobId: "job-4" }, ctx),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("throws CONFLICT when job is FAILED", async () => {
    const mockFindFirst = vi.fn().mockResolvedValue({
      id: "job-5",
      status: "FAILED",
      triggerRunId: null,
    });
    const ctx = makeCtx({ job: { findFirst: mockFindFirst } });

    await expect(
      handleCancelRun({ jobId: "job-5" }, ctx),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("throws CONFLICT when job is PARTIAL", async () => {
    const mockFindFirst = vi.fn().mockResolvedValue({
      id: "job-6",
      status: "PARTIAL",
      triggerRunId: null,
    });
    const ctx = makeCtx({ job: { findFirst: mockFindFirst } });

    await expect(
      handleCancelRun({ jobId: "job-6" }, ctx),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("commandHandlers registry", () => {
  it("registers all 9 handlers", () => {
    expect(commandHandlers.GenerateDigest).toBe(handleGenerateDigest);
    expect(commandHandlers.AddSubreddit).toBe(handleAddSubreddit);
    expect(commandHandlers.RemoveSubreddit).toBe(handleRemoveSubreddit);
    expect(commandHandlers.UpdateSubreddit).toBe(handleUpdateSubreddit);
    expect(commandHandlers.UpdateConfig).toBe(handleUpdateConfig);
    expect(commandHandlers.CancelRun).toBe(handleCancelRun);
    expect(commandHandlers.CreateProfile).toBe(handleCreateProfile);
    expect(commandHandlers.UpdateProfile).toBe(handleUpdateProfile);
    expect(commandHandlers.DeleteProfile).toBe(handleDeleteProfile);
  });
});
