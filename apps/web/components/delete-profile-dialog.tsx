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
import { deleteProfileAction } from "@/lib/actions";
import type {
  SerializedProfile,
  ActionResult,
  ProfileOptimisticAction,
} from "@/lib/types";

interface DeleteProfileDialogProps {
  profile: SerializedProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOptimistic: (action: ProfileOptimisticAction) => void;
}

export function DeleteProfileDialog({
  profile,
  open,
  onOpenChange,
  onOptimistic,
}: DeleteProfileDialogProps) {
  const [state, formAction, isPending] = useActionState<
    ActionResult<{ profileId: string }>,
    FormData
  >(deleteProfileAction, null);

  useActionToast(
    state,
    `Deleted profile "${profile.name}"`,
    () => onOpenChange(false),
  );

  function handleSubmit(formData: FormData) {
    startTransition(() => {
      onOptimistic({ type: "remove", id: profile.profileId });
      formAction(formData);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-mono">Delete Profile</DialogTitle>
          <DialogDescription>
            Delete profile{" "}
            <span className="font-mono font-medium">{profile.name}</span>? This
            action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit}>
          <input type="hidden" name="profileId" value={profile.profileId} />

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
              Delete
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
