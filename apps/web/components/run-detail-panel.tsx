"use client";

import { useActionState, startTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { JobStatus } from "@redgest/db/enums";
import { fetchDigestForJob, cancelRunAction } from "@/lib/actions";
import { useActionToast } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { DigestContent } from "@/components/digest-content";
import { formatSubredditNames, type ActionResult } from "@/lib/types";

function CancelForm({
  jobId,
  cancelAction,
  isCanceling,
}: {
  jobId: string;
  cancelAction: (payload: FormData) => void;
  isCanceling: boolean;
}) {
  return (
    <form
      action={(fd: FormData) => {
        startTransition(() => cancelAction(fd));
      }}
    >
      <input type="hidden" name="jobId" value={jobId} />
      <Button
        type="submit"
        variant="destructive"
        size="sm"
        disabled={isCanceling}
      >
        {isCanceling && (
          <Loader2 className="mr-1.5 size-4 animate-spin" />
        )}
        Cancel Run
      </Button>
    </form>
  );
}

interface RunDetailPanelProps {
  jobId: string;
  status: string;
  error?: string | null;
}

export function RunDetailPanel({ jobId, status, error }: RunDetailPanelProps) {
  const isTerminal =
    status === JobStatus.COMPLETED ||
    status === JobStatus.PARTIAL ||
    status === JobStatus.FAILED ||
    status === JobStatus.CANCELED;

  const { data: digest, isLoading } = useQuery({
    queryKey: ["digest", jobId],
    queryFn: () => fetchDigestForJob(jobId),
    enabled: status !== JobStatus.QUEUED,
    staleTime: isTerminal ? Infinity : 0,
  });

  const [cancelState, cancelAction, isCanceling] = useActionState<
    ActionResult<{ jobId: string; status: string }>,
    FormData
  >(cancelRunAction, null);

  useActionToast(cancelState, "Run canceled");

  if (status === JobStatus.QUEUED) {
    return (
      <div className="space-y-4 py-6 text-center">
        <p className="text-sm text-muted-foreground">
          Job is queued — digest not yet available.
        </p>
        <CancelForm jobId={jobId} cancelAction={cancelAction} isCanceling={isCanceling} />
      </div>
    );
  }

  if (status === JobStatus.CANCELED && !digest) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm font-medium text-slate-400">Run canceled</p>
        {error && (
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        )}
      </div>
    );
  }

  if (status === JobStatus.FAILED && !digest) {
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
      <div className="space-y-4 py-6 text-center">
        <p className="text-sm text-muted-foreground">
          {status === JobStatus.RUNNING
            ? "Digest is being generated..."
            : "No digest available for this run."}
        </p>
        {status === JobStatus.RUNNING && (
          <CancelForm jobId={jobId} cancelAction={cancelAction} isCanceling={isCanceling} />
        )}
      </div>
    );
  }

  const subreddits = formatSubredditNames(digest.subredditList);

  return (
    <div className="min-w-0 space-y-3 py-4">
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>
          <strong className="text-foreground">{digest.postCount}</strong> posts
        </span>
        {subreddits !== "—" && <span>{subreddits}</span>}
      </div>
      {digest.contentHtml ? (
        <div
          className="prose prose-sm dark:prose-invert max-w-none break-words"
          dangerouslySetInnerHTML={{ __html: digest.contentHtml }}
        />
      ) : digest.contentMarkdown ? (
        <DigestContent markdown={digest.contentMarkdown} />
      ) : null}
      <div className="flex justify-end pt-2">
        <Link href="/digests" className="text-xs text-primary hover:underline">
          View in Digests
        </Link>
      </div>
    </div>
  );
}
