import type { Metadata } from "next";
import { mono, sans } from "@/lib/fonts";
import { Providers } from "@/components/providers";
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
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
