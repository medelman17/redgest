import type { Metadata } from "next";
import { mono, sans } from "@/lib/fonts";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import "@/globals.css";

export const metadata: Metadata = {
  title: "Redgest — Sign In",
  description: "Sign in to your Redgest account",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} font-sans antialiased`}>
        <Providers>
          <div className="flex min-h-screen items-center justify-center bg-background">
            <div className="w-full max-w-md space-y-6 p-8">
              {children}
            </div>
          </div>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
