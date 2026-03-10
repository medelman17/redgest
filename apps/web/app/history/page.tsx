import { listRuns, listSubreddits } from "@/lib/dal";
import { serializeRun } from "@/lib/types";
import { RunHistoryTable } from "@/components/run-history-table";

export default async function HistoryPage() {
  const [runs, subreddits] = await Promise.all([
    listRuns(),
    listSubreddits(),
  ]);

  const serializedRuns = runs.map(serializeRun);

  const subredditMap = Object.fromEntries(
    subreddits.map((s) => [s.id, s.name]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          Run History
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          View past digest runs, job statuses, and generated content
        </p>
      </div>
      <RunHistoryTable
        initialData={serializedRuns}
        subredditMap={subredditMap}
      />
    </div>
  );
}
