"use client";

import { Fragment, useState, useTransition } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { JobStatus } from "@redgest/db/enums";
import { DigestContent } from "@/components/digest-content";
import { DeliveryBadges } from "@/components/delivery-badges";
import { fetchDeliveryStatus } from "@/lib/actions";
import { formatSubredditNames, type SerializedDigest } from "@/lib/types";
import type { DeliveryStatusChannel } from "@redgest/core";

interface DigestTableProps {
  digests: SerializedDigest[];
}

function statusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === JobStatus.COMPLETED) return "default";
  if (status === JobStatus.PARTIAL) return "secondary";
  if (status === JobStatus.FAILED) return "destructive";
  return "outline";
}

export function DigestTable({ digests }: DigestTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deliveryCache, setDeliveryCache] = useState<
    Record<string, DeliveryStatusChannel[]>
  >({});
  const [, startTransition] = useTransition();

  function toggleRow(digestId: string) {
    if (expandedId === digestId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(digestId);
    if (!deliveryCache[digestId]) {
      startTransition(async () => {
        const result = await fetchDeliveryStatus(digestId);
        const found = result.digests.find((d) => d.digestId === digestId);
        setDeliveryCache((prev) => ({
          ...prev,
          [digestId]: found?.channels ?? [],
        }));
      });
    }
  }

  if (digests.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
        No digests generated yet
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Date</TableHead>
            <TableHead>Posts</TableHead>
            <TableHead>Subreddits</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Delivery</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {digests.map((digest) => {
            const isExpanded = expandedId === digest.digestId;
            const channels = deliveryCache[digest.digestId];

            return (
              <Fragment key={digest.digestId}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() => toggleRow(digest.digestId)}
                >
                  <TableCell className="text-muted-foreground">
                    {isExpanded ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {new Date(digest.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-sm">{digest.postCount}</TableCell>
                  <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                    {formatSubredditNames(digest.subredditList)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(digest.jobStatus)}>
                      {digest.jobStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {channels ? (
                      <DeliveryBadges channels={channels} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
                {isExpanded && (
                  <TableRow key={`${digest.digestId}-expanded`}>
                    <TableCell
                      colSpan={6}
                      className="bg-muted/30 p-4"
                    >
                      <div className="space-y-4">
                        {digest.contentMarkdown ? (
                          <DigestContent markdown={digest.contentMarkdown} />
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No content available.
                          </p>
                        )}
                        {channels && channels.length > 0 && (
                          <div className="flex items-center gap-2 pt-2">
                            <span className="text-xs text-muted-foreground">
                              Delivery:
                            </span>
                            <DeliveryBadges channels={channels} />
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
