"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { JobStatus } from "@redgest/db/enums";
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
  const { data: runs } = useQuery({
    queryKey: ["runs"],
    queryFn: fetchRuns,
    initialData,
    staleTime: 30_000,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const hasActive = data.some(
        (r) => r.status === JobStatus.QUEUED || r.status === JobStatus.RUNNING,
      );
      return hasActive ? 5000 : false;
    },
  });

  const columns = useMemo(
    () => createColumns(subredditMap),
    [subredditMap],
  );

  return (
    <DataTable
      columns={columns}
      data={runs ?? []}
      initialSorting={[{ id: "startedAt", desc: true }]}
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
