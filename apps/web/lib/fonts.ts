import { JetBrains_Mono, IBM_Plex_Sans } from "next/font/google";

export const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const sans = IBM_Plex_Sans({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-sans",
});
