import { getTrendingTopics, getLlmMetrics, getCrawlStatus, listRuns } from "@/lib/dal";
import { serializeRun } from "@/lib/types";
import { DashboardPanels } from "@/components/dashboard-panels";

export default async function DashboardPage() {
  const [topics, llmMetrics, crawlStatus, runsResult] = await Promise.all([
    getTrendingTopics({ limit: 10, since: "7d" }),
    getLlmMetrics({ limit: 10 }),
    getCrawlStatus(),
    listRuns(5),
  ]);

  const recentRuns = runsResult.items.map(serializeRun);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of trending topics, LLM usage, and system health
        </p>
      </div>
      <DashboardPanels
        topics={topics}
        llmMetrics={llmMetrics}
        crawlStatus={crawlStatus}
        recentRuns={recentRuns}
      />
    </div>
  );
}
