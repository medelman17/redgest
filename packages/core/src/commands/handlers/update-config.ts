import type { CommandHandler } from "../types.js";

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
    where: { id: 1 },
    update: changes,
    create: {
      id: 1,
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
