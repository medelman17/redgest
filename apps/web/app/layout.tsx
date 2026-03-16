import type { Metadata } from "next";
import { mono, sans } from "@/lib/fonts";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "@/components/app-sidebar";
import { Providers } from "@/components/providers";
import { ThemeToggle } from "@/components/theme-toggle";
import { OrgSwitcher } from "@/components/org-switcher";
import { Toaster } from "@/components/ui/sonner";
import "@/globals.css";

export const metadata: Metadata = {
  title: "Redgest",
  description: "Personal Reddit digest engine",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} font-sans antialiased`}>
        <Providers>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
                <SidebarTrigger className="-ml-1" />
                <Separator orientation="vertical" className="mr-2 h-4" />
                <OrgSwitcher />
                <ThemeToggle className="ml-auto" />
              </header>
              <main className="flex-1 p-4 sm:p-6">
                {children}
              </main>
            </SidebarInset>
          </SidebarProvider>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
