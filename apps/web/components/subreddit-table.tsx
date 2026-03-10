"use client";

import { useOptimistic, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatRelativeTime } from "@/lib/utils";
import type { SerializedSubreddit, OptimisticAction } from "@/lib/types";
import { SubredditDialog } from "@/components/subreddit-dialog";
import { DeleteSubredditDialog } from "@/components/delete-subreddit-dialog";

interface SubredditTableProps {
  subreddits: SerializedSubreddit[];
}

export function SubredditTable({ subreddits }: SubredditTableProps) {
  const [optimisticSubs, dispatchOptimistic] = useOptimistic(
    subreddits,
    (state: SerializedSubreddit[], action: OptimisticAction) => {
      switch (action.type) {
        case "add":
          return [...state, action.subreddit];
        case "remove":
          return state.filter((s) => s.id !== action.id);
        case "update":
          return state.map((s) =>
            s.id === action.id ? { ...s, ...action.changes } : s,
          );
      }
    },
  );

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editSub, setEditSub] = useState<SerializedSubreddit | null>(null);
  const [deleteSub, setDeleteSub] = useState<SerializedSubreddit | null>(null);

  return (
    <>
      {optimisticSubs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <p className="text-sm text-muted-foreground">
            No subreddits configured yet
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="mr-1.5 size-4" />
            Add your first subreddit
          </Button>
        </div>
      ) : (
        <>
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddDialogOpen(true)}
            >
              <Plus className="mr-1.5 size-4" />
              Add Subreddit
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Insight Prompt</TableHead>
                <TableHead>Max Posts</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Digest</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {optimisticSubs.map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell className="font-mono">r/{sub.name}</TableCell>
                  <TableCell className="max-w-[200px]">
                    {sub.insightPrompt ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block truncate cursor-default">
                            {sub.insightPrompt}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="bottom"
                          className="max-w-sm whitespace-pre-wrap"
                        >
                          {sub.insightPrompt}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-muted-foreground">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell>{sub.maxPosts}</TableCell>
                  <TableCell>
                    <Badge variant={sub.isActive ? "default" : "secondary"}>
                      {sub.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(sub.lastDigestDate, "Never")}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => setEditSub(sub)}
                      >
                        <Pencil className="size-4" />
                        <span className="sr-only">Edit {sub.name}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteSub(sub)}
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">Delete {sub.name}</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      {addDialogOpen && (
        <SubredditDialog
          mode="add"
          open={true}
          onOpenChange={(o) => {
            if (!o) setAddDialogOpen(false);
          }}
          onOptimistic={dispatchOptimistic}
        />
      )}

      {editSub && (
        <SubredditDialog
          mode="edit"
          subreddit={editSub}
          open={true}
          onOpenChange={(open) => {
            if (!open) setEditSub(null);
          }}
          onOptimistic={dispatchOptimistic}
        />
      )}

      {deleteSub && (
        <DeleteSubredditDialog
          subreddit={deleteSub}
          open={true}
          onOpenChange={(open) => {
            if (!open) setDeleteSub(null);
          }}
          onOptimistic={dispatchOptimistic}
        />
      )}
    </>
  );
}
