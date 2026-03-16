"use client";

import { useActionState, startTransition } from "react";
import { Loader2 } from "lucide-react";
import { useActionToast } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addSubredditAction,
  updateSubredditAction,
} from "@/lib/actions";
import type { SerializedSubreddit, ActionResult, OptimisticAction } from "@/lib/types";

interface SubredditDialogProps {
  mode: "add" | "edit";
  subreddit?: SerializedSubreddit;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOptimistic: (action: OptimisticAction) => void;
}

function stripSubredditPrefix(name: string): string {
  return name.replace(/^r\//, "").trim();
}

export function SubredditDialog({
  mode,
  subreddit,
  open,
  onOpenChange,
  onOptimistic,
}: SubredditDialogProps) {
  const action = mode === "add" ? addSubredditAction : updateSubredditAction;
  const [state, formAction, isPending] = useActionState<ActionResult<{ subredditId: string }>, FormData>(
    action,
    null,
  );

  useActionToast(
    state,
    mode === "add" ? "Subreddit added" : "Subreddit updated",
    () => onOpenChange(false),
  );

  function handleSubmit(formData: FormData) {
    if (mode === "add") {
      const name = stripSubredditPrefix(String(formData.get("name") ?? ""));
      formData.set("name", name);
      formData.set("displayName", name);

      const now = new Date().toISOString();
      startTransition(() => {
        onOptimistic({
          type: "add",
          subreddit: {
            id: crypto.randomUUID(),
            name,
            organizationId: "",
            insightPrompt: String(formData.get("insightPrompt") ?? "") || null,
            maxPosts: Number(formData.get("maxPosts")) || 5,
            includeNsfw: formData.get("nsfw") === "on",
            isActive: true,
            crawlIntervalMinutes: 30,
            nextCrawlAt: null,
            createdAt: now,
            updatedAt: now,
            lastDigestDate: null,
            postsInLastDigest: 0,
            totalPostsFetched: 0,
            totalDigestsAppearedIn: 0,
          },
        });
        formAction(formData);
      });
    } else if (subreddit) {
      startTransition(() => {
        onOptimistic({
          type: "update",
          id: subreddit.id,
          changes: {
            insightPrompt: String(formData.get("insightPrompt") ?? "") || null,
            maxPosts: Number(formData.get("maxPosts")) || subreddit.maxPosts,
            isActive: formData.get("active") === "on",
          },
        });
        formAction(formData);
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono">
            {mode === "add" ? "Add Subreddit" : "Edit Subreddit"}
          </DialogTitle>
          <DialogDescription>
            {mode === "add"
              ? "Add a new subreddit to monitor for your digest."
              : `Editing r/${subreddit?.name}`}
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="space-y-4">
          {mode === "edit" && subreddit && (
            <input type="hidden" name="subredditId" value={subreddit.id} />
          )}

          {mode === "add" && (
            <div className="space-y-2">
              <Label htmlFor="name">Subreddit Name</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">r/</span>
                <Input
                  id="name"
                  name="name"
                  placeholder="MachineLearning"
                  pattern="[A-Za-z0-9_]{3,21}"
                  title="3-21 characters, letters, numbers, and underscores"
                  required
                  autoFocus
                />
              </div>
            </div>
          )}

          {mode === "edit" && subreddit && (
            <div className="space-y-2">
              <Label>Subreddit</Label>
              <p className="font-mono text-sm">r/{subreddit.name}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="insightPrompt">Insight Prompt</Label>
            <Textarea
              id="insightPrompt"
              name="insightPrompt"
              placeholder="e.g. Focus on practical tutorials and breakthrough research papers"
              defaultValue={subreddit?.insightPrompt ?? ""}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxPosts">Max Posts</Label>
            <Input
              id="maxPosts"
              name="maxPosts"
              type="number"
              min={1}
              max={100}
              defaultValue={subreddit?.maxPosts ?? 5}
            />
          </div>

          {mode === "add" && (
            <div className="flex items-center gap-2">
              <input
                id="nsfw"
                name="nsfw"
                type="checkbox"
                className="size-4 rounded border-border accent-primary"
              />
              <Label htmlFor="nsfw" className="text-sm font-normal">
                Include NSFW content
              </Label>
            </div>
          )}

          {mode === "edit" && (
            <div className="flex items-center gap-2">
              <input
                id="active"
                name="active"
                type="checkbox"
                defaultChecked={subreddit?.isActive}
                className="size-4 rounded border-border accent-primary"
              />
              <Label htmlFor="active" className="text-sm font-normal">
                Active (include in digests)
              </Label>
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              {mode === "add" ? "Add Subreddit" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
