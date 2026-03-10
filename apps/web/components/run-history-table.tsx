"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchRuns } from "@/lib/actions";
import { DataTable } from "@/components/data-table";
import { createColumns } from "@/components/run-columns";
import { RunDetailPanel } from "@/components/run-detail-panel";
import type { SerializedRun } from "@/lib/types";

interface RunHistoryTableProps {
  initialData: SerializedRun[];
  subredditMap: Record<string, string>;
}

export function RunHistoryTable({
  initialData,
  subredditMap,
}: RunHistoryTableProps) {
  const { data: runs } = useQuery<SerializedRun[]>({
    queryKey: ["runs"],
    queryFn: fetchRuns as unknown as () => Promise<SerializedRun[]>,
    initialData,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const hasActive = data.some(
        (r) => r.status === "QUEUED" || r.status === "RUNNING",
      );
      return hasActive ? 5000 : false;
    },
  });

  const columns = createColumns(subredditMap);

  return (
    <DataTable
      columns={columns}
      data={(runs ?? []) as SerializedRun[]}
      renderSubComponent={({ row }) => (
        <RunDetailPanel
          jobId={row.original.jobId}
          status={row.original.status}
          error={row.original.error}
        />
      )}
    />
  );
}
