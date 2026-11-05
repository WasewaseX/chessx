import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/shell/theme-provider";

export const metadata: Metadata = {
  title: "ChessX",
  description:
    "Interactive lessons from first move to grandmaster, rated puzzles, engine play and AI coaches that talk. Bring your own API key if you want.",
  icons: { icon: "/brand.svg" },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "ChessX", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#312e2b",
};

// No puzzle bootstrapping happens here or anywhere else: puzzles stream live
// from the free Lichess puzzle API plus the small in-git pack (the 1.57GB
// disk bank is retired), so there is nothing to install, kick or warm.
// layout.tsx is compiled for the client bundle too, and gh-snapshot needs
// node:child_process, which webpack cannot resolve in a browser graph —
// node-only boot work stays behind the guarded import in
// src/instrumentation.ts (server-only runtime hook).

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
