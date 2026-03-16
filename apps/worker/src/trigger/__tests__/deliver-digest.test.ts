import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist mock factories so vi.mock() factories can reference them
const {
  mockFindUniqueOrThrow,
  mockRecordDeliveryPending,
  mockRecordDeliveryResult,
  mockSendDigestEmail,
  mockSendDigestSlack,
  mockBuildDeliveryData,
  mockBuildFormattedDigest,
  mockGenerateDeliveryProse,
  mockLoadConfig,
  mockLoggerInfo,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockFindUniqueOrThrow: vi.fn(),
  mockRecordDeliveryPending: vi.fn().mockResolvedValue(undefined),
  mockRecordDeliveryResult: vi.fn().mockResolvedValue(undefined),
  mockSendDigestEmail: vi.fn().mockResolvedValue({ id: "email-123" }),
  mockSendDigestSlack: vi.fn().mockResolvedValue(undefined),
  mockBuildDeliveryData: vi.fn(() => ({ subreddits: [] })),
  mockBuildFormattedDigest: vi.fn(() => ({ title: "Test Digest", sections: [] })),
  mockGenerateDeliveryProse: vi.fn().mockResolvedValue({ data: { headline: "", sections: [] } }),
  mockLoadConfig: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock("@trigger.dev/sdk/v3", () => ({
  task: (config: {
    id: string;
    retry?: unknown;
    run: (...args: unknown[]) => unknown;
  }) => config,
  logger: {
    info: mockLoggerInfo,
    warn: vi.fn(),
    error: mockLoggerError,
  },
}));

vi.mock("@redgest/config", () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock("@redgest/db", () => ({
  prisma: {
    digest: {
      findUniqueOrThrow: mockFindUniqueOrThrow,
    },
  },
}));

vi.mock("@redgest/core", () => ({
  recordDeliveryPending: mockRecordDeliveryPending,
  recordDeliveryResult: mockRecordDeliveryResult,
}));

vi.mock("@redgest/email", () => ({
  sendDigestEmail: mockSendDigestEmail,
  buildDeliveryData: mockBuildDeliveryData,
  buildFormattedDigest: mockBuildFormattedDigest,
}));

vi.mock("@redgest/llm", () => ({
  generateDeliveryProse: mockGenerateDeliveryProse,
}));

vi.mock("@redgest/slack", () => ({
  sendDigestSlack: mockSendDigestSlack,
}));

import { deliverDigest as _deliverDigest } from "../deliver-digest.js";

// The task() mock strips the SDK wrapper and returns the config object directly,
// so at runtime deliverDigest has { id, retry, run } — cast to expose them.
const deliverDigest = _deliverDigest as unknown as {
  id: string;
  retry: { maxAttempts: number };
  run: (payload: { digestId: string; organizationId?: string }) => Promise<{ delivered: string[] }>;
};

// Default digest fixture
const defaultDigest = {
  id: "digest-1",
  jobId: "job-1",
  digestPosts: [],
};

// Default config with both channels
function bothChannelsConfig() {
  return {
    DATABASE_URL: "postgres://localhost/test",
    RESEND_API_KEY: "re_test",
    DELIVERY_EMAIL: "test@test.com",
    SLACK_WEBHOOK_URL: "https://hooks.slack.com/test",
    MCP_SERVER_PORT: 3100,
    DIGEST_CRON: "0 7 * * *",
    LOG_LEVEL: "info" as const,
    NODE_ENV: "test" as const,
  };
}

describe("deliver-digest task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUniqueOrThrow.mockResolvedValue(defaultDigest);
    mockLoadConfig.mockReturnValue(bothChannelsConfig());
    mockRecordDeliveryPending.mockResolvedValue(undefined);
    mockRecordDeliveryResult.mockResolvedValue(undefined);
    mockSendDigestEmail.mockResolvedValue({ id: "email-123" });
    mockSendDigestSlack.mockResolvedValue(undefined);
  });

  it("delivers to both email and slack when both configured", async () => {
    const result = await deliverDigest.run({ digestId: "digest-1" });

    expect(mockSendDigestEmail).toHaveBeenCalledOnce();
    expect(mockSendDigestSlack).toHaveBeenCalledOnce();
    expect(result).toEqual({ delivered: ["email", "slack"] });
  });

  it("accepts optional organizationId in payload", async () => {
    const result = await deliverDigest.run({ digestId: "digest-1", organizationId: "org_123" });

    expect(mockSendDigestEmail).toHaveBeenCalledOnce();
    expect(mockSendDigestSlack).toHaveBeenCalledOnce();
    expect(result).toEqual({ delivered: ["email", "slack"] });
  });


  it("skips delivery when no channels configured", async () => {
    mockLoadConfig.mockReturnValue({
      DATABASE_URL: "postgres://localhost/test",
      MCP_SERVER_PORT: 3100,
      DIGEST_CRON: "0 7 * * *",
      LOG_LEVEL: "info" as const,
      NODE_ENV: "test" as const,
    });

    const result = await deliverDigest.run({ digestId: "digest-1" });

    expect(mockSendDigestEmail).not.toHaveBeenCalled();
    expect(mockSendDigestSlack).not.toHaveBeenCalled();
    expect(mockRecordDeliveryPending).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: [] });
  });

  it("records delivery pending before sending", async () => {
    await deliverDigest.run({ digestId: "digest-1" });

    expect(mockRecordDeliveryPending).toHaveBeenCalledOnce();
    expect(mockRecordDeliveryPending).toHaveBeenCalledWith(
      expect.anything(), // prisma as DeliveryClient
      "digest-1",
      "job-1",
      expect.arrayContaining(["EMAIL", "SLACK"]),
    );
  });

  it("records delivery result for each channel after delivery", async () => {
    await deliverDigest.run({ digestId: "digest-1" });

    expect(mockRecordDeliveryResult).toHaveBeenCalledTimes(2);

    // Email result — sendDigestEmail resolves with { id: "email-123" }
    expect(mockRecordDeliveryResult).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      "job-1",
      "EMAIL",
      { ok: true, externalId: "email-123" },
    );

    // Slack result — sendDigestSlack resolves with undefined (no id)
    expect(mockRecordDeliveryResult).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      "job-1",
      "SLACK",
      { ok: true, externalId: undefined },
    );
  });

  it("throws when all channels fail", async () => {
    mockSendDigestEmail.mockRejectedValueOnce(new Error("SMTP error"));
    mockSendDigestSlack.mockRejectedValueOnce(new Error("Webhook 500"));

    await expect(
      deliverDigest.run({ digestId: "digest-1" }),
    ).rejects.toThrow("All delivery channels failed");
  });

  it("records failure results when channels fail", async () => {
    mockSendDigestEmail.mockRejectedValueOnce(new Error("SMTP error"));
    mockSendDigestSlack.mockRejectedValueOnce(new Error("Webhook 500"));

    await expect(
      deliverDigest.run({ digestId: "digest-1" }),
    ).rejects.toThrow();

    expect(mockRecordDeliveryResult).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      "job-1",
      "EMAIL",
      { ok: false, error: "SMTP error" },
    );
    expect(mockRecordDeliveryResult).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      "job-1",
      "SLACK",
      { ok: false, error: "Webhook 500" },
    );
  });

  it("succeeds when email fails but slack succeeds", async () => {
    mockSendDigestEmail.mockRejectedValueOnce(new Error("SMTP error"));

    const result = await deliverDigest.run({ digestId: "digest-1" });

    expect(result).toEqual({ delivered: ["slack"] });
    expect(mockRecordDeliveryResult).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      "job-1",
      "EMAIL",
      { ok: false, error: "SMTP error" },
    );
    expect(mockRecordDeliveryResult).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      "job-1",
      "SLACK",
      { ok: true, externalId: undefined },
    );
  });

  it("succeeds when slack fails but email succeeds", async () => {
    mockSendDigestSlack.mockRejectedValueOnce(new Error("Webhook 500"));

    const result = await deliverDigest.run({ digestId: "digest-1" });

    expect(result).toEqual({ delivered: ["email"] });
    expect(mockRecordDeliveryResult).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      "job-1",
      "EMAIL",
      { ok: true, externalId: "email-123" },
    );
    expect(mockRecordDeliveryResult).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      "job-1",
      "SLACK",
      { ok: false, error: "Webhook 500" },
    );
  });

  it("only pushes email channel when only email configured", async () => {
    mockLoadConfig.mockReturnValue({
      DATABASE_URL: "postgres://localhost/test",
      RESEND_API_KEY: "re_test",
      DELIVERY_EMAIL: "test@test.com",
      MCP_SERVER_PORT: 3100,
      DIGEST_CRON: "0 7 * * *",
      LOG_LEVEL: "info" as const,
      NODE_ENV: "test" as const,
    });

    const result = await deliverDigest.run({ digestId: "digest-1" });

    expect(mockSendDigestEmail).toHaveBeenCalledOnce();
    expect(mockSendDigestSlack).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: ["email"] });
  });

  it("only pushes slack channel when only slack configured", async () => {
    mockLoadConfig.mockReturnValue({
      DATABASE_URL: "postgres://localhost/test",
      SLACK_WEBHOOK_URL: "https://hooks.slack.com/test",
      MCP_SERVER_PORT: 3100,
      DIGEST_CRON: "0 7 * * *",
      LOG_LEVEL: "info" as const,
      NODE_ENV: "test" as const,
    });

    const result = await deliverDigest.run({ digestId: "digest-1" });

    expect(mockSendDigestSlack).toHaveBeenCalledOnce();
    expect(mockSendDigestEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: ["slack"] });
  });

  it("logs delivery complete after successful send", async () => {
    await deliverDigest.run({ digestId: "digest-1" });

    expect(mockLoggerInfo).toHaveBeenCalledWith("Delivery complete", {
      delivered: ["email", "slack"],
    });
  });

  it("passes email and api key from config to sendDigestEmail", async () => {
    await deliverDigest.run({ digestId: "digest-1" });

    expect(mockSendDigestEmail).toHaveBeenCalledWith(
      expect.anything(), // deliveryData
      "test@test.com",
      "re_test",
    );
  });

  it("passes webhook url from config to sendDigestSlack", async () => {
    await deliverDigest.run({ digestId: "digest-1" });

    expect(mockSendDigestSlack).toHaveBeenCalledWith(
      expect.anything(), // deliveryData
      "https://hooks.slack.com/test",
    );
  });
});
