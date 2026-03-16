"use client";

import { useActionState, startTransition, useState } from "react";
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
  createProfileAction,
  updateProfileAction,
} from "@/lib/actions";
import {
  parseSubredditList,
  type SerializedProfile,
  type SerializedSubreddit,
  type ActionResult,
  type ProfileOptimisticAction,
} from "@/lib/types";

interface ProfileDialogProps {
  mode: "add" | "edit";
  profile?: SerializedProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOptimistic: (action: ProfileOptimisticAction) => void;
  subreddits: SerializedSubreddit[];
}

export function ProfileDialog({
  mode,
  profile,
  open,
  onOpenChange,
  onOptimistic,
  subreddits,
}: ProfileDialogProps) {
  const action = mode === "add" ? createProfileAction : updateProfileAction;
  const [state, formAction, isPending] = useActionState<
    ActionResult<{ profileId: string }>,
    FormData
  >(action, null);

  const initialSubredditIds =
    mode === "edit" && profile
      ? parseSubredditList(profile.subredditList).map((s) => s.id)
      : [];
  const [selectedSubredditIds, setSelectedSubredditIds] =
    useState<string[]>(initialSubredditIds);

  useActionToast(
    state,
    mode === "add" ? "Profile created" : "Profile updated",
    () => onOpenChange(false),
  );

  function handleSubredditToggle(id: string) {
    setSelectedSubredditIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }

  function handleSubmit(formData: FormData) {
    // Inject the comma-joined subredditIds into formData
    formData.set("subredditIds", selectedSubredditIds.join(","));

    if (mode === "add") {
      const name = String(formData.get("name") ?? "").trim();
      const now = new Date().toISOString();
      const optimisticSubredditList = subreddits
        .filter((s) => selectedSubredditIds.includes(s.id))
        .map((s) => ({ id: s.id, name: s.name }));

      startTransition(() => {
        onOptimistic({
          type: "add",
          profile: {
            profileId: crypto.randomUUID(),
            name,
            organizationId: "",
            insightPrompt:
              String(formData.get("insightPrompt") ?? "") || null,
            schedule: String(formData.get("schedule") ?? "") || null,
            lookbackHours:
              Number(formData.get("lookbackHours")) || 24,
            maxPosts: Number(formData.get("maxPosts")) || 10,
            delivery: String(formData.get("delivery") ?? "NONE"),
            isActive: true,
            createdAt: now,
            updatedAt: now,
            subredditList: optimisticSubredditList,
            subredditCount: optimisticSubredditList.length,
          },
        });
        formAction(formData);
      });
    } else if (profile) {
      const optimisticSubredditList = subreddits
        .filter((s) => selectedSubredditIds.includes(s.id))
        .map((s) => ({ id: s.id, name: s.name }));

      startTransition(() => {
        onOptimistic({
          type: "update",
          id: profile.profileId,
          changes: {
            insightPrompt:
              String(formData.get("insightPrompt") ?? "") || null,
            schedule: String(formData.get("schedule") ?? "") || null,
            lookbackHours:
              Number(formData.get("lookbackHours")) || profile.lookbackHours,
            maxPosts:
              Number(formData.get("maxPosts")) || profile.maxPosts,
            delivery: String(formData.get("delivery") ?? profile.delivery),
            isActive: formData.get("active") === "on",
            subredditList: optimisticSubredditList,
            subredditCount: optimisticSubredditList.length,
          },
        });
        formAction(formData);
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono">
            {mode === "add" ? "Create Profile" : "Edit Profile"}
          </DialogTitle>
          <DialogDescription>
            {mode === "add"
              ? "Create a new digest profile with custom settings."
              : `Editing profile: ${profile?.name}`}
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="space-y-4">
          {mode === "edit" && profile && (
            <input type="hidden" name="profileId" value={profile.profileId} />
          )}

          {mode === "add" && (
            <div className="space-y-2">
              <Label htmlFor="name">Profile Name</Label>
              <Input
                id="name"
                name="name"
                placeholder="e.g. Morning AI Digest"
                required
                autoFocus
              />
            </div>
          )}

          {mode === "edit" && profile && (
            <div className="space-y-2">
              <Label>Profile</Label>
              <p className="font-mono text-sm">{profile.name}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="insightPrompt">Insight Prompt</Label>
            <Textarea
              id="insightPrompt"
              name="insightPrompt"
              placeholder="e.g. Focus on practical tutorials and breakthrough research papers"
              defaultValue={profile?.insightPrompt ?? ""}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule">Schedule (cron expression)</Label>
            <Input
              id="schedule"
              name="schedule"
              placeholder="e.g. 0 7 * * * (daily at 7am)"
              defaultValue={profile?.schedule ?? ""}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="lookbackHours">Lookback Hours</Label>
              <Input
                id="lookbackHours"
                name="lookbackHours"
                type="number"
                min={1}
                max={168}
                defaultValue={profile?.lookbackHours ?? 24}
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
                defaultValue={profile?.maxPosts ?? 10}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="delivery">Delivery Channel</Label>
            <select
              id="delivery"
              name="delivery"
              defaultValue={profile?.delivery ?? "NONE"}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="NONE">None</option>
              <option value="EMAIL">Email</option>
              <option value="SLACK">Slack</option>
              <option value="ALL">All</option>
            </select>
          </div>

          {subreddits.length > 0 && (
            <div className="space-y-2">
              <Label>Subreddits</Label>
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border border-input p-3">
                {subreddits.map((sub) => (
                  <div key={sub.id} className="flex items-center gap-2">
                    <input
                      id={`sub-${sub.id}`}
                      type="checkbox"
                      checked={selectedSubredditIds.includes(sub.id)}
                      onChange={() => handleSubredditToggle(sub.id)}
                      className="size-4 rounded border-border accent-primary"
                    />
                    <label
                      htmlFor={`sub-${sub.id}`}
                      className="cursor-pointer font-mono text-sm"
                    >
                      r/{sub.name}
                    </label>
                  </div>
                ))}
              </div>
              {/* Hidden field: comma-joined IDs injected in handleSubmit */}
              <input type="hidden" name="subredditIds" value="" />
            </div>
          )}

          {mode === "edit" && (
            <div className="flex items-center gap-2">
              <input
                id="active"
                name="active"
                type="checkbox"
                defaultChecked={profile?.isActive}
                className="size-4 rounded border-border accent-primary"
              />
              <Label htmlFor="active" className="text-sm font-normal">
                Active (include in scheduled digests)
              </Label>
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              {mode === "add" ? "Create Profile" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
