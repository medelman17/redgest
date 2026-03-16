"use client";

import { useState, useEffect } from "react";
import { authClient } from "@redgest/auth/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Org {
  id: string;
  name: string;
}

export function OrgSwitcher() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sessionResult, orgsResult] = await Promise.all([
          authClient.getSession(),
          authClient.organization.list(),
        ]);

        const sessionOrgs = (orgsResult.data ?? []) as Org[];
        setOrgs(sessionOrgs);

        const activeId = sessionResult.data?.session?.activeOrganizationId ?? null;
        setActiveOrgId(activeId);
      } catch {
        // Ignore errors — component simply won't render
      }
    };
    void fetchData();
  }, []);

  // Only render when user has 2+ orgs
  if (orgs.length < 2) {
    return null;
  }

  async function handleOrgChange(orgId: string) {
    try {
      await authClient.organization.setActive({ organizationId: orgId });
      setActiveOrgId(orgId);
      // Reload to pick up new org context across all server components
      window.location.reload();
    } catch {
      // Ignore errors silently
    }
  }

  return (
    <Select value={activeOrgId ?? undefined} onValueChange={handleOrgChange}>
      <SelectTrigger className="h-8 w-[180px] text-sm" size="sm">
        <SelectValue placeholder="Select organization" />
      </SelectTrigger>
      <SelectContent>
        {orgs.map((org) => (
          <SelectItem key={org.id} value={org.id}>
            {org.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
