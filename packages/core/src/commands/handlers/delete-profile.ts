import type { CommandHandler } from "../types";
import { RedgestError } from "../../errors";

export const handleDeleteProfile: CommandHandler<"DeleteProfile"> = async (
  params,
  ctx,
) => {
  const profile = await ctx.db.digestProfile.findFirst({
    where: { id: params.profileId, organizationId: ctx.organizationId },
    select: { id: true, name: true },
  });
  if (!profile) {
    throw new RedgestError("NOT_FOUND", `Profile not found: ${params.profileId}`);
  }
  if (profile.name === "Default") {
    throw new RedgestError(
      "VALIDATION_ERROR",
      'Cannot delete the "Default" profile',
    );
  }

  await ctx.db.digestProfile.delete({
    where: { id: profile.id },
  });

  return {
    data: { profileId: profile.id },
    event: { profileId: profile.id, name: profile.name },
  };
};
