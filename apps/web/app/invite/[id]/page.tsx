"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { authClient } from "@redgest/auth/client";
import { Button } from "@/components/ui/button";

export default function AcceptInvitationPage() {
  const router = useRouter();
  const params = useParams();
  const invitationId = typeof params["id"] === "string" ? params["id"] : "";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    if (!invitationId) {
      setError("Invalid invitation link");
      return;
    }

    setLoading(true);
    setError(null);

    const result = await authClient.organization.acceptInvitation({
      invitationId,
    });

    setLoading(false);

    if (result.error) {
      setError(result.error.message ?? "Failed to accept invitation");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  if (!invitationId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">Invalid invitation</h1>
          <p className="text-muted-foreground">
            This invitation link is invalid or has expired.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-6 p-8 text-center">
        <h1 className="text-2xl font-bold">Accept invitation</h1>
        <p className="text-muted-foreground">
          You&apos;ve been invited to join an organization on Redgest.
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button
          className="w-full"
          onClick={handleAccept}
          disabled={loading}
        >
          {loading ? "Accepting..." : "Accept invitation"}
        </Button>
      </div>
    </div>
  );
}
