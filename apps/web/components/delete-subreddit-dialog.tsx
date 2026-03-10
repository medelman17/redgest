"use client";

import { useActionState, startTransition } from "react";
import { Loader2 } from "lucide-react";
import { useActionToast } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { removeSubredditAction } from "@/lib/actions";
import type { SerializedSubreddit, ActionResult, OptimisticAction } from "@/lib/types";

interface DeleteSubredditDialogProps {
  subreddit: SerializedSubreddit;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOptimistic: (action: OptimisticAction) => void;
}

export function DeleteSubredditDialog({
  subreddit,
  open,
  onOpenChange,
  onOptimistic,
}: DeleteSubredditDialogProps) {
  const [state, formAction, isPending] = useActionState<ActionResult<{ subredditId: string }>, FormData>(
    removeSubredditAction,
    null,
  );

  useActionToast(
    state,
    `Removed r/${subreddit.name}`,
    () => onOpenChange(false),
  );

  function handleSubmit(formData: FormData) {
    startTransition(() => {
      onOptimistic({ type: "remove", id: subreddit.id });
      formAction(formData);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-mono">Remove Subreddit</DialogTitle>
          <DialogDescription>
            Remove <span className="font-mono font-medium">r/{subreddit.name}</span>?
            This will stop monitoring this subreddit.
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit}>
          <input type="hidden" name="subredditId" value={subreddit.id} />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
