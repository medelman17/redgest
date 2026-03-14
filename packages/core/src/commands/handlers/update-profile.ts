import type { CommandHandler } from "../types.js";
import { RedgestError } from "../../errors.js";

export const handleUpdateProfile: CommandHandler<"UpdateProfile"> = async (
  params,
  ctx,
) => {
  const existing = await ctx.db.digestProfile.findUnique({
    where: { id: params.profileId },
    select: { id: true },
  });
  if (!existing) {
    throw new RedgestError("NOT_FOUND", `Profile not found: ${params.profileId}`);
  }

  // If subredditIds provided, replace the full set
  if (params.subredditIds !== undefined) {
    await ctx.db.digestProfileSubreddit.deleteMany({
      where: { profileId: params.profileId },
    });
    if (params.subredditIds.length > 0) {
      await ctx.db.digestProfileSubreddit.createMany({
        data: params.subredditIds.map((id) => ({
          profileId: params.profileId,
          subredditId: id,
        })),
      });
    }
  }

  await ctx.db.digestProfile.update({
    where: { id: params.profileId },
    data: {
      ...(params.name !== undefined && { name: params.name }),
      ...(params.insightPrompt !== undefined && { insightPrompt: params.insightPrompt }),
      ...(params.schedule !== undefined && { schedule: params.schedule }),
      ...(params.lookbackHours !== undefined && { lookbackHours: params.lookbackHours }),
      ...(params.maxPosts !== undefined && { maxPosts: params.maxPosts }),
      ...(params.delivery !== undefined && { delivery: params.delivery }),
      ...(params.active !== undefined && { isActive: params.active }),
    },
  });

  return {
    data: { profileId: params.profileId },
    event: null,
  };
};
