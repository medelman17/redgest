"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { DeliveryChannel } from "@redgest/db";
import * as dal from "@/lib/dal";
import {
  serializeDigest,
  serializeRun,
  serializeProfile,
  serializeSearchResult,
  type ActionResult,
} from "@/lib/types";

// --- Helpers ---

function parseCommaSeparated(value: unknown): string[] | undefined {
  return typeof value === "string" && value ? value.split(",") : undefined;
}

/** Map known Prisma error codes to user-friendly messages. */
const PRISMA_ERROR_MESSAGES: Record<string, string> = {
  P2002: "A record with this value already exists.",
  P2025: "The record you tried to update or delete was not found.",
  P2003: "This record is referenced by other data and cannot be removed.",
};

/** Sanitize errors so internal details (Prisma, stack traces) never reach the client. */
function toUserError(err: unknown): string {
  // Domain errors from @redgest/core — already user-friendly
  if (err instanceof Error && err.name === "RedgestError") {
    return err.message;
  }
  // Prisma errors have a `code` property like "P2002"
  if (err instanceof Error && "code" in err && typeof (err as Record<string, unknown>).code === "string") {
    const code = (err as Record<string, unknown>).code as string;
    const friendly = PRISMA_ERROR_MESSAGES[code];
    if (friendly) return friendly;
  }
  // Fallback — never expose raw message
  return "An unexpected error occurred. Please try again.";
}

// --- Schemas ---

// Helper: FormData sends booleans as "on"/"true" strings
const formDataBoolean = z.preprocess(
  (v) => v === "on" || v === "true" || v === true,
  z.boolean(),
);

const addSubredditSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1),
  insightPrompt: z.string().optional(),
  maxPosts: z.coerce.number().int().min(1).max(100).optional(),
  nsfw: formDataBoolean.optional(),
});

const updateSubredditSchema = z.object({
  subredditId: z.string().min(1),
  insightPrompt: z.string().optional(),
  maxPosts: z.coerce.number().int().min(1).max(100).optional(),
  active: formDataBoolean.optional(),
});

const removeSubredditSchema = z.object({
  subredditId: z.string().min(1),
});

const updateConfigSchema = z.object({
  globalInsightPrompt: z.string().optional(),
  defaultLookbackHours: z.coerce.number().int().min(1).max(168).optional(),
  llmProvider: z.string().optional(),
  llmModel: z.string().optional(),
  defaultDelivery: z.enum(
    Object.values(DeliveryChannel) as [DeliveryChannel, ...DeliveryChannel[]],
  ).optional(),
  schedule: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().nullable().optional(),
  ),
});

const generateDigestSchema = z.object({
  subredditIds: z.array(z.string()).optional(),
  lookbackHours: z.coerce.number().int().min(1).max(168).optional(),
  profileId: z.string().optional(),
});

const createProfileSchema = z.object({
  name: z.string().min(1),
  insightPrompt: z.string().optional(),
  schedule: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().nullable().optional(),
  ),
  lookbackHours: z.coerce.number().int().min(1).max(168).optional(),
  maxPosts: z.coerce.number().int().min(1).max(100).optional(),
  delivery: z.enum(
    Object.values(DeliveryChannel) as [DeliveryChannel, ...DeliveryChannel[]],
  ).optional(),
  subredditIds: z.array(z.string()).optional(),
});

const updateProfileSchema = z.object({
  profileId: z.string().min(1),
  name: z.string().min(1).optional(),
  insightPrompt: z.string().optional(),
  schedule: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().nullable().optional(),
  ),
  lookbackHours: z.coerce.number().int().min(1).max(168).optional(),
  maxPosts: z.coerce.number().int().min(1).max(100).optional(),
  delivery: z.enum(
    Object.values(DeliveryChannel) as [DeliveryChannel, ...DeliveryChannel[]],
  ).optional(),
  subredditIds: z.array(z.string()).optional(),
  active: formDataBoolean.optional(),
});

const deleteProfileSchema = z.object({
  profileId: z.string().min(1),
});

const cancelRunSchema = z.object({
  jobId: z.string().min(1),
});

// --- Actions ---

export async function addSubredditAction(
  _prevState: ActionResult<{ subredditId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ subredditId: string }>> {
  const parsed = addSubredditSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  try {
    const result = await dal.addSubreddit(parsed.data);
    revalidatePath("/subreddits");
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: toUserError(err) };
  }
}

export async function updateSubredditAction(
  _prevState: ActionResult<{ subredditId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ subredditId: string }>> {
  const parsed = updateSubredditSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  try {
    const result = await dal.updateSubreddit(parsed.data);
    revalidatePath("/subreddits");
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: toUserError(err) };
  }
}

export async function removeSubredditAction(
  _prevState: ActionResult<{ subredditId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ subredditId: string }>> {
  const parsed = removeSubredditSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  try {
    const result = await dal.removeSubreddit(parsed.data.subredditId);
    revalidatePath("/subreddits");
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: toUserError(err) };
  }
}

export async function updateConfigAction(
  _prevState: ActionResult<{ success: true }> | null,
  formData: FormData,
): Promise<ActionResult<{ success: true }>> {
  const parsed = updateConfigSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  try {
    const result = await dal.updateConfig(parsed.data);
    revalidatePath("/settings");
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: toUserError(err) };
  }
}

export async function generateDigestAction(
  _prevState: ActionResult<{ jobId: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ jobId: string; status: string }>> {
  const raw = Object.fromEntries(formData.entries());
  const subredditIds = parseCommaSeparated(raw.subredditIds);
  const parsed = generateDigestSchema.safeParse({
    ...raw,
    subredditIds,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  try {
    const result = await dal.generateDigest(parsed.data);
    revalidatePath("/history");
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: toUserError(err) };
  }
}

// --- Query actions (for client-side TanStack Query) ---

export async function fetchRunStatus(jobId: string) {
  return dal.getRunStatus(jobId);
}

export async function fetchSubreddits() {
  return dal.listSubreddits();
}

export async function fetchRuns() {
  const runs = await dal.listRuns();
  return runs.items.map(serializeRun);
}

export async function fetchDigestForJob(jobId: string) {
  const digest = await dal.getDigestByJobId(jobId);
  return digest ? serializeDigest(digest) : null;
}

// --- Profile actions ---

export async function createProfileAction(
  _prevState: ActionResult<{ profileId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ profileId: string }>> {
  const raw = Object.fromEntries(formData.entries());
  const subredditIds = parseCommaSeparated(raw.subredditIds);
  const parsed = createProfileSchema.safeParse({ ...raw, subredditIds });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  try {
    const result = await dal.createProfile(parsed.data);
    revalidatePath("/profiles");
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function updateProfileAction(
  _prevState: ActionResult<{ profileId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ profileId: string }>> {
  const raw = Object.fromEntries(formData.entries());
  const subredditIds = parseCommaSeparated(raw.subredditIds);
  const parsed = updateProfileSchema.safeParse({ ...raw, subredditIds });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  try {
    const result = await dal.updateProfile(parsed.data);
    revalidatePath("/profiles");
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function deleteProfileAction(
  _prevState: ActionResult<{ profileId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ profileId: string }>> {
  const parsed = deleteProfileSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  try {
    const result = await dal.deleteProfile(parsed.data.profileId);
    revalidatePath("/profiles");
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function cancelRunAction(
  _prevState: ActionResult<{ jobId: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ jobId: string; status: string }>> {
  const parsed = cancelRunSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  try {
    const result = await dal.cancelRun(parsed.data.jobId);
    revalidatePath("/history");
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function fetchProfiles() {
  const profiles = await dal.listProfiles();
  return profiles.map(serializeProfile);
}

export async function fetchDigests(limit?: number) {
  const result = await dal.listDigests(limit);
  return {
    items: result.items.map(serializeDigest),
    nextCursor: result.nextCursor,
  };
}

export async function fetchDeliveryStatus(digestId: string) {
  return dal.getDeliveryStatus(digestId);
}

// --- Search actions (for client-side use) ---

export async function fetchSearchResults(params: {
  query: string;
  subreddit?: string;
  since?: string;
  sentiment?: string;
  minScore?: number;
  limit?: number;
}) {
  const results = await dal.searchPosts(params);
  return results.map(serializeSearchResult);
}

