import type { CommandHandler } from "../types";

export const handleUpdateConfig: CommandHandler<"UpdateConfig"> = async (
  params,
  ctx,
) => {
  const changes: Record<string, unknown> = {};

  if (params.globalInsightPrompt !== undefined) {
    changes.globalInsightPrompt = params.globalInsightPrompt;
  }
  if (params.defaultLookbackHours !== undefined) {
    changes.defaultLookback = `${params.defaultLookbackHours}h`;
  }
  if (params.maxDigestPosts !== undefined) {
    changes.maxDigestPosts = params.maxDigestPosts;
  }
  if (params.llmProvider !== undefined) {
    changes.llmProvider = params.llmProvider;
  }
  if (params.llmModel !== undefined) {
    changes.llmModel = params.llmModel;
  }
  if (params.defaultDelivery !== undefined) {
    changes.defaultDelivery = params.defaultDelivery;
  }
  if (params.schedule !== undefined) {
    changes.schedule = params.schedule;
  }

  await ctx.db.config.upsert({
    where: { organizationId: ctx.organizationId },
    update: changes,
    create: {
      organizationId: ctx.organizationId,
      globalInsightPrompt:
        (changes.globalInsightPrompt as string | undefined) ?? "",
      llmProvider: (changes.llmProvider as string | undefined) ?? "anthropic",
      llmModel:
        (changes.llmModel as string | undefined) ??
        "claude-sonnet-4-20250514",
      ...changes,
    },
  });

  return {
    data: { success: true as const },
    event: { changes },
  };
};
