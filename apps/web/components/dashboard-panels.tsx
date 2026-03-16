"use client";

import { Brain, Activity, TrendingUp, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelativeTime } from "@/lib/utils";
import type { TrendingTopic, LlmMetrics, CrawlStatusItem } from "@redgest/core";
import { type SerializedRun } from "@/lib/types";

interface DashboardPanelsProps {
  topics: TrendingTopic[];
  llmMetrics: LlmMetrics;
  crawlStatus: CrawlStatusItem[];
  recentRuns: SerializedRun[];
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function getStatusVariant(
  status: string,
): "default" | "destructive" | "secondary" {
  if (
    status === "COMPLETED" ||
    status === "PARTIAL" ||
    status === "RUNNING" ||
    status === "QUEUED"
  )
    return "default";
  if (status === "FAILED") return "destructive";
  return "secondary";
}

export function DashboardPanels({
  topics,
  llmMetrics,
  crawlStatus,
  recentRuns,
}: DashboardPanelsProps) {
  const { summary, byTask } = llmMetrics;
  const activeCount = crawlStatus.length;
  const healthyCount = crawlStatus.filter(
    (s) => s.lastCrawlStatus === "ok",
  ).length;

  return (
    <div className="space-y-6">
      {/* Summary stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total LLM Calls
              </CardTitle>
              <Brain className="size-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.totalCalls}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatTokens(summary.totalInputTokens + summary.totalOutputTokens)}{" "}
              tokens total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Cache Hit Rate
              </CardTitle>
              <Activity className="size-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {(summary.cacheHitRate * 100).toFixed(1)}%
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Avg {Math.round(summary.averageDurationMs)}ms per call
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Active Subreddits
              </CardTitle>
              <TrendingUp className="size-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{activeCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {healthyCount} healthy
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Trending Topics
              </CardTitle>
              <Clock className="size-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{topics.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">Last 7 days</p>
          </CardContent>
        </Card>
      </div>

      {/* Lower panels — 2-col grid on lg */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Trending Topics */}
        <Card>
          <CardHeader>
            <CardTitle>Trending Topics</CardTitle>
          </CardHeader>
          <CardContent>
            {topics.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No topics extracted yet
              </p>
            ) : (
              <ul className="space-y-2">
                {topics.map((topic) => (
                  <li
                    key={topic.name}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate text-sm font-medium">
                      {topic.name}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {topic.recentPostCount} posts
                      </span>
                      <Badge variant="secondary">{topic.frequency}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* LLM Usage by Task */}
        <Card>
          <CardHeader>
            <CardTitle>LLM Usage by Task</CardTitle>
          </CardHeader>
          <CardContent>
            {byTask.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No LLM calls recorded
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Avg ms</TableHead>
                    <TableHead className="text-right">Cache %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byTask.map((row) => (
                    <TableRow key={row.task}>
                      <TableCell className="font-mono text-xs">
                        {row.task}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {row.calls}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatTokens(row.inputTokens + row.outputTokens)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {Math.round(row.avgDurationMs)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {(row.cacheHitRate * 100).toFixed(0)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Crawl Health */}
        <Card>
          <CardHeader>
            <CardTitle>Crawl Health</CardTitle>
          </CardHeader>
          <CardContent>
            {crawlStatus.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No subreddits configured
              </p>
            ) : (
              <ul className="space-y-2">
                {crawlStatus.map((item) => (
                  <li
                    key={item.subreddit}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`size-2 shrink-0 rounded-full ${
                          item.lastCrawlStatus === "ok"
                            ? "bg-green-500"
                            : item.lastCrawlStatus === "failed"
                              ? "bg-red-500"
                              : "bg-gray-400"
                        }`}
                      />
                      <span className="font-mono text-sm">
                        r/{item.subreddit}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                      <span>{item.totalPosts} posts</span>
                      <span>
                        {formatRelativeTime(item.lastCrawledAt, "Never")}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent Runs */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Runs</CardTitle>
          </CardHeader>
          <CardContent>
            {recentRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs yet</p>
            ) : (
              <ul className="space-y-2">
                {recentRuns.map((run) => {
                  const subCount = Array.isArray(run.subreddits) ? run.subreddits.length : 0;
                  return (
                    <li
                      key={run.jobId}
                      className="flex items-center justify-between gap-2"
                    >
                      <Badge variant={getStatusVariant(run.status)}>
                        {run.status}
                      </Badge>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>
                          {subCount} subreddit
                          {subCount !== 1 ? "s" : ""}
                        </span>
                        <span>{formatRelativeTime(run.createdAt)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
