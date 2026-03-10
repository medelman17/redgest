"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, ChevronRight, ArrowUpDown, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SerializedRun } from "@/lib/types";

const STATUS_STYLES: Record<string, string> = {
  COMPLETED: "bg-green-600/20 text-green-400 border-green-600/30",
  RUNNING: "bg-yellow-600/20 text-yellow-400 border-yellow-600/30",
  QUEUED: "bg-slate-600/20 text-slate-400 border-slate-600/30",
  FAILED: "bg-red-600/20 text-red-400 border-red-600/30",
  PARTIAL: "bg-orange-600/20 text-orange-400 border-orange-600/30",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={STATUS_STYLES[status] ?? ""}>
      {status}
    </Badge>
  );
}

function formatDuration(seconds: number | null, status: string): string {
  if (seconds === null || seconds === undefined) {
    if (status === "RUNNING" || status === "QUEUED") return "";
    return "\u2014";
  }
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatSubreddits(
  subreddits: unknown,
  subredditMap: Record<string, string>,
): string {
  if (!Array.isArray(subreddits)) return "\u2014";
  if (subreddits.length === 0) return "\u2014";
  return subreddits
    .map((id: string) => {
      const name = subredditMap[id];
      return name ? `r/${name}` : id.slice(0, 8);
    })
    .join(", ");
}

export function createColumns(
  subredditMap: Record<string, string>,
): ColumnDef<SerializedRun, unknown>[] {
  return [
    {
      id: "expand",
      header: () => null,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => row.toggleExpanded()}
        >
          {row.getIsExpanded() ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
          <span className="sr-only">
            {row.getIsExpanded() ? "Collapse" : "Expand"}
          </span>
        </Button>
      ),
      enableSorting: false,
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Status
          <ArrowUpDown className="ml-1 size-3" />
        </Button>
      ),
      cell: ({ getValue }) => <StatusBadge status={getValue() as string} />,
    },
    {
      id: "subreddits",
      header: "Subreddits",
      accessorFn: (row) => row.subreddits,
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {formatSubreddits(row.original.subreddits, subredditMap)}
        </span>
      ),
      enableSorting: false,
    },
    {
      accessorKey: "startedAt",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Started
          <ArrowUpDown className="ml-1 size-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const dateStr = row.original.startedAt;
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default text-muted-foreground">
                {formatRelativeTime(dateStr)}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {dateStr ? new Date(dateStr).toLocaleString() : "Not started"}
            </TooltipContent>
          </Tooltip>
        );
      },
      sortingFn: "datetime",
    },
    {
      accessorKey: "durationSeconds",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Duration
          <ArrowUpDown className="ml-1 size-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const status = row.original.status;
        const dur = row.original.durationSeconds;
        if (status === "RUNNING" || status === "QUEUED") {
          return (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              {status === "RUNNING" ? "running..." : "queued"}
            </span>
          );
        }
        return (
          <span className="text-muted-foreground font-mono text-xs">
            {formatDuration(dur, status)}
          </span>
        );
      },
      sortUndefined: "last",
    },
    {
      accessorKey: "eventCount",
      header: "Events",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {getValue() as number}
        </span>
      ),
      enableSorting: false,
    },
  ];
}
