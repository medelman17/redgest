"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { fetchDigestForJob } from "@/lib/actions";

interface RunDetailPanelProps {
  jobId: string;
  status: string;
  error?: string | null;
}

export function RunDetailPanel({ jobId, status, error }: RunDetailPanelProps) {
  const { data: digest, isLoading } = useQuery({
    queryKey: ["digest", jobId],
    queryFn: () => fetchDigestForJob(jobId),
    enabled: status !== "QUEUED",
  });

  if (status === "QUEUED") {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        Job is queued — digest not yet available.
      </div>
    );
  }

  if (status === "FAILED" && !digest) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm font-medium text-red-400">Run failed</p>
        {error && (
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!digest) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        {status === "RUNNING"
          ? "Digest is being generated..."
          : "No digest available for this run."}
      </div>
    );
  }

  const subreddits = Array.isArray(digest.subredditList)
    ? (digest.subredditList as string[]).join(", ")
    : "";

  return (
    <div className="space-y-3 py-4">
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>
          <strong className="text-foreground">{digest.postCount}</strong> posts
        </span>
        {subreddits && <span>{subreddits}</span>}
      </div>
      {digest.contentHtml ? (
        <div
          className="prose prose-invert prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: digest.contentHtml }}
        />
      ) : digest.contentMarkdown ? (
        <pre className="whitespace-pre-wrap text-sm text-muted-foreground">
          {digest.contentMarkdown}
        </pre>
      ) : null}
    </div>
  );
}
