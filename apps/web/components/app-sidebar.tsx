"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Rss, Settings, Clock, Play, Layers, BookOpen, Search, LayoutDashboard, LogOut, User } from "lucide-react";
import { authClient } from "@redgest/auth/client";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const NAV_ITEMS = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Subreddits", href: "/subreddits", icon: Rss },
  { title: "Profiles", href: "/profiles", icon: Layers },
  { title: "Digests", href: "/digests", icon: BookOpen },
  { title: "Search", href: "/search", icon: Search },
  { title: "Settings", href: "/settings", icon: Settings },
  { title: "History", href: "/history", icon: Clock },
  { title: "Trigger", href: "/trigger", icon: Play },
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary font-mono text-sm font-bold text-primary-foreground">
            R
          </div>
          <span className="font-mono text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            Redgest
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.href}
                    tooltip={item.title}
                  >
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          {session?.user && (
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={session.user.email}>
                <User />
                <span className="truncate">{session.user.name ?? session.user.email}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Sign out" onClick={handleSignOut}>
              <LogOut />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
