import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/types";

/** Show toast on Server Action completion. Calls `onSuccess` when `state.ok`. */
export function useActionToast(
  state: ActionResult<unknown>,
  successMessage: string,
  onSuccess?: () => void,
) {
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(successMessage);
      onSuccessRef.current?.();
    } else {
      toast.error(state.error);
    }
  }, [state, successMessage]);
}
