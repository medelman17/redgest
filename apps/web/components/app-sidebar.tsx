"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Rss, Settings, Clock, Play, Layers, BookOpen } from "lucide-react";
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
  { title: "Subreddits", href: "/subreddits", icon: Rss },
  { title: "Profiles", href: "/profiles", icon: Layers },
  { title: "Digests", href: "/digests", icon: BookOpen },
  { title: "Settings", href: "/settings", icon: Settings },
  { title: "History", href: "/history", icon: Clock },
  { title: "Trigger", href: "/trigger", icon: Play },
] as const;

export function AppSidebar() {
  const pathname = usePathname();

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
        <div className="flex items-center justify-between px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:justify-center">
          <span className="group-data-[collapsible=icon]:hidden">
            ⌘B to collapse
          </span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
