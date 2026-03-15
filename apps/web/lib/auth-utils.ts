import "server-only";
import { auth } from "@redgest/auth";
import { headers } from "next/headers";
import { DEFAULT_ORGANIZATION_ID } from "@redgest/config";

export async function getOrganizationId(): Promise<string> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    if (session?.session?.activeOrganizationId) {
      return session.session.activeOrganizationId;
    }
  } catch {
    // Session read failed — fall back to env
  }
  return process.env.REDGEST_ORG_ID ?? DEFAULT_ORGANIZATION_ID;
}

export async function getSession() {
  try {
    return await auth.api.getSession({
      headers: await headers(),
    });
  } catch {
    return null;
  }
}
