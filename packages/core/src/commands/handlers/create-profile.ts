import type { CommandHandler } from "../types";
import { RedgestError } from "../../errors";

export const handleCreateProfile: CommandHandler<"CreateProfile"> = async (
  params,
  ctx,
) => {
  // Check for name collision within the organization
  const existing = await ctx.db.digestProfile.findFirst({
    where: { name: params.name, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (existing) {
    throw new RedgestError(
      "CONFLICT",
      `A profile named "${params.name}" already exists`,
    );
  }

  const profile = await ctx.db.digestProfile.create({
    data: {
      name: params.name,
      organizationId: ctx.organizationId,
      insightPrompt: params.insightPrompt ?? null,
      schedule: params.schedule ?? null,
      lookbackHours: params.lookbackHours ?? 24,
      maxPosts: params.maxPosts ?? 5,
      delivery: params.delivery ?? "NONE",
      subreddits:
        params.subredditIds && params.subredditIds.length > 0
          ? {
              create: params.subredditIds.map((id) => ({
                subredditId: id,
              })),
            }
          : undefined,
    },
  });

  return {
    data: { profileId: profile.id },
    event: { profileId: profile.id, name: profile.name },
  };
};
