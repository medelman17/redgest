import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks (must be before imports) ─────────────────────────────

vi.mock("@trigger.dev/sdk/v3", () => ({
  schedules: {
    task: (config: {
      id: string;
      cron: string;
      run: (...args: unknown[]) => unknown;
    }) => config,
  },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  idempotencyKeys: { create: vi.fn().mockResolvedValue("test-key") },
  AbortTaskRunError: class AbortTaskRunError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "AbortTaskRunError";
    }
  },
}));

vi.mock("@redgest/db", () => ({
  prisma: {
    digestProfile: { findMany: vi.fn().mockResolvedValue([]) },
    subreddit: { findMany: vi.fn().mockResolvedValue([]) },
    job: {
      create: vi.fn().mockResolvedValue({ id: "job-1" }),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("../generate-digest.js", () => ({
  generateDigest: { trigger: vi.fn().mockResolvedValue({ id: "run-1" }) },
}));

// ── Imports after mocks ───────────────────────────────────────────────

import { scheduledDigest } from "../scheduled-digest.js";
import { prisma } from "@redgest/db";
import { generateDigest } from "../generate-digest.js";
import { AbortTaskRunError } from "@trigger.dev/sdk/v3";

// ── Helpers ───────────────────────────────────────────────────────────

// schedules.task() mock strips the wrapper, so scheduledDigest has a `run` property
const runTask = () =>
  (scheduledDigest as unknown as { run: () => Promise<unknown> }).run();

// Helper to create mock return values without inline object literal assertions
function mockJobCreate(id: string) {
  return vi.mocked(prisma.job.create).mockResolvedValue(
    Object.assign(Object.create(null), { id }) as ReturnType<
      typeof prisma.job.create
    > extends Promise<infer T> ? T : never,
  );
}

function mockJobCreateOnce(id: string) {
  return vi.mocked(prisma.job.create).mockResolvedValueOnce(
    Object.assign(Object.create(null), { id }) as ReturnType<
      typeof prisma.job.create
    > extends Promise<infer T> ? T : never,
  );
}

function mockSubreddits(subs: Array<{ id: string }>) {
  return vi.mocked(prisma.subreddit.findMany).mockResolvedValue(
    subs as Awaited<ReturnType<typeof prisma.subreddit.findMany>>,
  );
}

function mockProfiles(profiles: unknown[]) {
  return vi.mocked(prisma.digestProfile.findMany).mockResolvedValue(
    profiles as Awaited<ReturnType<typeof prisma.digestProfile.findMany>>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("scheduled-digest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to safe defaults after clearAllMocks wipes resolved values
    vi.mocked(prisma.digestProfile.findMany).mockResolvedValue([]);
    vi.mocked(prisma.subreddit.findMany).mockResolvedValue([]);
    mockJobCreate("job-1");
    vi.mocked(prisma.job.update).mockResolvedValue(
      Object.assign(Object.create(null), {}) as Awaited<
        ReturnType<typeof prisma.job.update>
      >,
    );
    vi.mocked(generateDigest.trigger).mockResolvedValue(
      Object.assign(Object.create(null), { id: "run-1" }) as Awaited<
        ReturnType<typeof generateDigest.trigger>
      >,
    );
  });

  describe("legacy mode (no active profiles)", () => {
    it("returns empty result when no profiles and no active subreddits", async () => {
      vi.mocked(prisma.digestProfile.findMany).mockResolvedValue([]);
      vi.mocked(prisma.subreddit.findMany).mockResolvedValue([]);

      const result = await runTask();

      expect(result).toEqual({ jobs: [], totalSubreddits: 0 });
      expect(prisma.job.create).not.toHaveBeenCalled();
      expect(generateDigest.trigger).not.toHaveBeenCalled();
    });

    it("creates one job and triggers generate-digest for all active subreddits", async () => {
      vi.mocked(prisma.digestProfile.findMany).mockResolvedValue([]);
      mockSubreddits([{ id: "sub-1" }, { id: "sub-2" }]);
      mockJobCreate("job-legacy");

      const result = await runTask();

      expect(prisma.job.create).toHaveBeenCalledWith({
        data: {
          status: "QUEUED",
          subreddits: ["sub-1", "sub-2"],
          lookback: "24h",
        },
      });

      expect(generateDigest.trigger).toHaveBeenCalledWith(
        { jobId: "job-legacy", subredditIds: ["sub-1", "sub-2"] },
        { idempotencyKey: "test-key" },
      );

      expect(result).toEqual({
        jobs: [{ jobId: "job-legacy", subredditCount: 2 }],
        totalSubreddits: 2,
      });
    });

    it("marks job FAILED and throws AbortTaskRunError when trigger dispatch fails", async () => {
      vi.mocked(prisma.digestProfile.findMany).mockResolvedValue([]);
      mockSubreddits([{ id: "sub-1" }]);
      mockJobCreate("job-fail");
      vi.mocked(generateDigest.trigger).mockRejectedValueOnce(
        new Error("dispatch error"),
      );

      await expect(runTask()).rejects.toThrow(AbortTaskRunError);

      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: "job-fail" },
        data: {
          status: "FAILED",
          completedAt: expect.any(Date),
          error: "dispatch error",
        },
      });
    });
  });

  describe("profile mode (active profiles with schedules)", () => {
    const makeProfile = (overrides: {
      id?: string;
      name?: string;
      subreddits?: Array<{ subredditId: string }>;
      lookbackHours?: number;
    }) => ({
      id: overrides.id ?? "profile-1",
      name: overrides.name ?? "Test Profile",
      isActive: true,
      schedule: "0 7 * * *",
      lookbackHours: overrides.lookbackHours ?? 24,
      subreddits: overrides.subreddits ?? [{ subredditId: "sub-1" }],
    });

    it("creates one job per active profile and triggers generate-digest for each", async () => {
      const profile1 = makeProfile({
        id: "profile-1",
        name: "Morning Digest",
        subreddits: [{ subredditId: "sub-1" }, { subredditId: "sub-2" }],
        lookbackHours: 24,
      });
      const profile2 = makeProfile({
        id: "profile-2",
        name: "Evening Digest",
        subreddits: [{ subredditId: "sub-3" }],
        lookbackHours: 12,
      });

      mockProfiles([profile1, profile2]);
      mockJobCreateOnce("job-p1");
      mockJobCreateOnce("job-p2");

      const result = await runTask();

      expect(prisma.job.create).toHaveBeenCalledTimes(2);
      expect(prisma.job.create).toHaveBeenNthCalledWith(1, {
        data: {
          status: "QUEUED",
          subreddits: ["sub-1", "sub-2"],
          lookback: "24h",
          profileId: "profile-1",
        },
      });
      expect(prisma.job.create).toHaveBeenNthCalledWith(2, {
        data: {
          status: "QUEUED",
          subreddits: ["sub-3"],
          lookback: "12h",
          profileId: "profile-2",
        },
      });

      expect(generateDigest.trigger).toHaveBeenCalledTimes(2);
      expect(generateDigest.trigger).toHaveBeenNthCalledWith(
        1,
        { jobId: "job-p1", subredditIds: ["sub-1", "sub-2"] },
        { idempotencyKey: "test-key" },
      );
      expect(generateDigest.trigger).toHaveBeenNthCalledWith(
        2,
        { jobId: "job-p2", subredditIds: ["sub-3"] },
        { idempotencyKey: "test-key" },
      );

      expect(result).toEqual({
        jobs: [
          { jobId: "job-p1", profileName: "Morning Digest", subredditCount: 2 },
          { jobId: "job-p2", profileName: "Evening Digest", subredditCount: 1 },
        ],
        totalSubreddits: 3,
      });
    });

    it("skips profiles with no subreddits", async () => {
      const profileWithSubs = makeProfile({
        id: "profile-1",
        name: "Active Profile",
        subreddits: [{ subredditId: "sub-1" }],
      });
      const profileNoSubs = makeProfile({
        id: "profile-2",
        name: "Empty Profile",
        subreddits: [],
      });

      mockProfiles([profileNoSubs, profileWithSubs]);
      mockJobCreate("job-p1");

      const result = await runTask();

      // Only one job created (for the profile with subreddits)
      expect(prisma.job.create).toHaveBeenCalledTimes(1);
      expect(generateDigest.trigger).toHaveBeenCalledTimes(1);

      expect(result).toEqual({
        jobs: [
          { jobId: "job-p1", profileName: "Active Profile", subredditCount: 1 },
        ],
        totalSubreddits: 1,
      });
    });

    it("continues processing remaining profiles when one dispatch fails", async () => {
      const profile1 = makeProfile({
        id: "profile-1",
        name: "Profile One",
        subreddits: [{ subredditId: "sub-1" }],
      });
      const profile2 = makeProfile({
        id: "profile-2",
        name: "Profile Two",
        subreddits: [{ subredditId: "sub-2" }],
      });

      mockProfiles([profile1, profile2]);
      mockJobCreateOnce("job-p1");
      mockJobCreateOnce("job-p2");

      // First trigger fails, second succeeds
      vi.mocked(generateDigest.trigger)
        .mockRejectedValueOnce(new Error("network timeout"))
        .mockResolvedValueOnce(
          Object.assign(Object.create(null), { id: "run-2" }) as Awaited<
            ReturnType<typeof generateDigest.trigger>
          >,
        );

      const result = await runTask();

      // Both jobs were created
      expect(prisma.job.create).toHaveBeenCalledTimes(2);
      // Both triggers were attempted
      expect(generateDigest.trigger).toHaveBeenCalledTimes(2);

      // First job marked FAILED
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: "job-p1" },
        data: {
          status: "FAILED",
          completedAt: expect.any(Date),
          error: "network timeout",
        },
      });

      // Only the successful profile appears in result
      expect(result).toEqual({
        jobs: [
          { jobId: "job-p2", profileName: "Profile Two", subredditCount: 1 },
        ],
        totalSubreddits: 1,
      });
    });
  });
});
