import type { QueryHandler } from "../types.js";

export const handleGetLlmMetrics: QueryHandler<"GetLlmMetrics"> = async (
  params,
  ctx,
) => {
  // Build where clause: scope to jobId, recent jobs, or all
  let where: Record<string, unknown> = {};
  if (params.jobId) {
    where = { jobId: params.jobId };
  } else {
    // Get recent distinct jobIds to scope aggregation
    const recentJobs = await ctx.db.llmCall.findMany({
      distinct: ["jobId"],
      orderBy: { createdAt: "desc" },
      take: params.limit ?? 10,
      select: { jobId: true },
    });
    const jobIds = recentJobs.map((j) => j.jobId);
    if (jobIds.length > 0) {
      where = { jobId: { in: jobIds } };
    }
  }

  // Aggregate totals
  const totals = await ctx.db.llmCall.aggregate({
    where,
    _count: { _all: true },
    _sum: { inputTokens: true, outputTokens: true },
    _avg: { durationMs: true },
  });

  const totalCalls = totals._count._all;

  // Cache hit count
  const cachedCount = await ctx.db.llmCall.count({
    where: { ...where, cached: true },
  });

  // Per-task breakdown
  const taskGroups = await ctx.db.llmCall.groupBy({
    by: ["task"],
    where,
    _count: { _all: true },
    _sum: { inputTokens: true, outputTokens: true },
    _avg: { durationMs: true },
  });

  // Per-task cached counts — only query if there are task groups
  const cachedByTask =
    taskGroups.length > 0
      ? await ctx.db.llmCall.groupBy({
          by: ["task"],
          where: { ...where, cached: true },
          _count: { _all: true },
        })
      : [];

  const cachedMap = new Map(
    cachedByTask.map((g) => [g.task, g._count._all]),
  );

  const byTask = taskGroups.map((g) => {
    const calls = g._count._all;
    const cached = cachedMap.get(g.task) ?? 0;
    return {
      task: g.task,
      calls,
      inputTokens: g._sum.inputTokens ?? 0,
      outputTokens: g._sum.outputTokens ?? 0,
      avgDurationMs: Math.round(g._avg.durationMs ?? 0),
      cacheHitRate: calls > 0 ? cached / calls : 0,
    };
  });

  return {
    summary: {
      totalCalls,
      totalInputTokens: totals._sum.inputTokens ?? 0,
      totalOutputTokens: totals._sum.outputTokens ?? 0,
      averageDurationMs: Math.round(totals._avg.durationMs ?? 0),
      cacheHitRate: totalCalls > 0 ? cachedCount / totalCalls : 0,
    },
    byTask,
  };
};
