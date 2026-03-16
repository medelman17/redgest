import "server-only";
import { cache } from "react";
import { auth } from "@redgest/auth";
import { headers } from "next/headers";
import { DEFAULT_ORGANIZATION_ID } from "@redgest/config";

// Memoize per-request via React cache() — avoids redundant session lookups
// when multiple DAL functions are called in the same Server Component render.
export const getSession = cache(async () => {
  try {
    return await auth.api.getSession({
      headers: await headers(),
    });
  } catch {
    return null;
  }
});

export async function getOrganizationId(): Promise<string> {
  const session = await getSession();
  if (session?.session?.activeOrganizationId) {
    return session.session.activeOrganizationId;
  }
  return process.env.REDGEST_ORG_ID ?? DEFAULT_ORGANIZATION_ID;
}
