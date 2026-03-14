"use client";

import { useActionState, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Loader2,
  Play,
  CheckCircle2,
  XCircle,
  ArrowRight,
} from "lucide-react";
import { JobStatus } from "@redgest/db/enums";
import { generateDigestAction, fetchRunStatus } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  SerializedSubreddit,
  SerializedProfile,
  ActionResult,
} from "@/lib/types";

interface DigestTriggerFormProps {
  subreddits: SerializedSubreddit[];
  profiles: SerializedProfile[];
  defaultLookbackHours: number;
}

export function DigestTriggerForm({
  subreddits,
  profiles,
  defaultLookbackHours,
}: DigestTriggerFormProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(subreddits.map((s) => s.id)),
  );
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("custom");
  const [lookbackHours, setLookbackHours] = useState(defaultLookbackHours);

  const [state, formAction, isPending] = useActionState(
    async (
      prev: ActionResult<{ jobId: string; status: string }>,
      formData: FormData,
    ) => {
      const result = await generateDigestAction(prev, formData);
      if (result?.ok) {
        setActiveJobId(result.data.jobId);
      }
      return result;
    },
    null,
  );

  const toggleSubreddit = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === subreddits.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(subreddits.map((s) => s.id)));
    }
  };

  const handleProfileChange = (value: string) => {
    setSelectedProfileId(value);
    if (value === "custom") return;
    const profile = profiles.find((p) => p.profileId === value);
    if (!profile) return;
    const subList = profile.subredditList as Array<{ id: string; name: string }>;
    setSelectedIds(new Set(subList.map((s) => s.id)));
    setLookbackHours(profile.lookbackHours);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-base">
            Configure Digest
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-6">
            {/* Hidden fields */}
            <input
              type="hidden"
              name="subredditIds"
              value={Array.from(selectedIds).join(",")}
            />
            {selectedProfileId !== "custom" && (
              <input
                type="hidden"
                name="profileId"
                value={selectedProfileId}
              />
            )}

            {/* Profile selection */}
            {profiles.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="profile">Profile</Label>
                <Select
                  value={selectedProfileId}
                  onValueChange={handleProfileChange}
                >
                  <SelectTrigger id="profile" className="w-64">
                    <SelectValue placeholder="Select a profile" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="custom">Custom</SelectItem>
                    {profiles.map((p) => (
                      <SelectItem key={p.profileId} value={p.profileId}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Select a profile to pre-fill subreddits and lookback hours
                </p>
              </div>
            )}

            {/* Subreddit selection */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Subreddits</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-2 py-1 text-xs text-muted-foreground"
                  onClick={toggleAll}
                >
                  {selectedIds.size === subreddits.length
                    ? "Deselect all"
                    : "Select all"}
                </Button>
              </div>

              {subreddits.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No active subreddits.{" "}
                  <Link href="/subreddits" className="text-primary underline">
                    Add some first
                  </Link>
                  .
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {subreddits.map((sub) => (
                    <label
                      key={sub.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md border p-3 transition-colors hover:bg-accent"
                    >
                      <Checkbox
                        checked={selectedIds.has(sub.id)}
                        onCheckedChange={() => toggleSubreddit(sub.id)}
                      />
                      <span className="text-sm font-medium">
                        r/{sub.name}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Lookback hours */}
            <div className="space-y-2">
              <Label htmlFor="lookbackHours">Lookback hours</Label>
              <Input
                id="lookbackHours"
                name="lookbackHours"
                type="number"
                min={1}
                max={168}
                value={lookbackHours}
                onChange={(e) => setLookbackHours(Number(e.target.value))}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                How far back to look for posts (1-168 hours)
              </p>
            </div>

            {/* Error message */}
            {state && !state.ok && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {state.error}
              </div>
            )}

            {/* Submit button */}
            <Button
              type="submit"
              disabled={isPending || selectedIds.size === 0 || !!activeJobId}
              className="gap-2"
            >
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Triggering...
                </>
              ) : (
                <>
                  <Play className="size-4" />
                  Generate Digest
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Job status card */}
      {activeJobId && (
        <JobStatusCard
          jobId={activeJobId}
          onReset={() => setActiveJobId(null)}
        />
      )}
    </div>
  );
}

function JobStatusCard({
  jobId,
  onReset,
}: {
  jobId: string;
  onReset: () => void;
}) {
  const { data: status } = useQuery({
    queryKey: ["runStatus", jobId],
    queryFn: () => fetchRunStatus(jobId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      if (
        data.status === JobStatus.COMPLETED ||
        data.status === JobStatus.FAILED ||
        data.status === JobStatus.PARTIAL ||
        data.status === JobStatus.CANCELED
      ) {
        return false;
      }
      return 2000;
    },
  });

  const isTerminal =
    status?.status === JobStatus.COMPLETED ||
    status?.status === JobStatus.FAILED ||
    status?.status === JobStatus.PARTIAL ||
    status?.status === JobStatus.CANCELED;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-mono text-base">
          Job Status
          {status && (
            <Badge
              variant={
                status.status === JobStatus.COMPLETED
                  ? "default"
                  : status.status === JobStatus.FAILED
                    ? "destructive"
                    : "secondary"
              }
            >
              {status.status}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!status && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading status...
          </div>
        )}

        {status && !isTerminal && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Processing digest...
          </div>
        )}

        {status?.status === JobStatus.COMPLETED && (
          <div className="flex items-center gap-2 text-sm text-green-500">
            <CheckCircle2 className="size-4" />
            Digest generated successfully
          </div>
        )}

        {status?.status === JobStatus.PARTIAL && (
          <div className="flex items-center gap-2 text-sm text-yellow-500">
            <CheckCircle2 className="size-4" />
            Digest generated with partial results
          </div>
        )}

        {status?.status === JobStatus.FAILED && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="size-4" />
            Digest generation failed
          </div>
        )}

        {status?.status === JobStatus.CANCELED && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <XCircle className="size-4" />
            Digest generation was canceled
          </div>
        )}

        <div className="flex gap-2">
          {isTerminal && (
            <>
              <Button asChild variant="outline" size="sm" className="gap-1">
                <Link href="/history">
                  View in History
                  <ArrowRight className="size-3" />
                </Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={onReset}>
                Generate Another
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
