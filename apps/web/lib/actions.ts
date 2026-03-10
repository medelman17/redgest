"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { DeliveryChannel } from "@redgest/db";
import * as dal from "@/lib/dal";
import type { ActionResult } from "@/lib/types";

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
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
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
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
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
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
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
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function generateDigestAction(
  _prevState: ActionResult<{ jobId: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ jobId: string; status: string }>> {
  const raw = Object.fromEntries(formData.entries());
  // Handle subredditIds as comma-separated or array
  const subredditIds = typeof raw.subredditIds === "string" && raw.subredditIds
    ? raw.subredditIds.split(",")
    : undefined;
  const parsed = generateDigestSchema.safeParse({
    ...raw,
    subredditIds,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  try {
    const result = await dal.generateDigest(parsed.data);
    revalidatePath("/trigger");
    revalidatePath("/history");
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// --- Query actions (for client-side TanStack Query) ---

export async function fetchRunStatus(jobId: string) {
  return dal.getRunStatus(jobId);
}

export async function fetchSubreddits() {
  return dal.listSubreddits();
}

export async function fetchRuns(): Promise<
  import("@/lib/types").SerializedRun[]
> {
  const runs = await dal.listRuns();
  const { serializeRun } = await import("@/lib/types");
  return runs.map(serializeRun);
}

export async function fetchDigestForJob(jobId: string) {
  return dal.getDigestByJobId(jobId);
}
