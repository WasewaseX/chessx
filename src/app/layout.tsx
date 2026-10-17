import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/shell/theme-provider";

export const metadata: Metadata = {
  title: "ChessX",
  description:
    "Interactive lessons from first move to grandmaster, rated puzzles, engine play and AI coaches that talk. Bring your own API key if you want.",
  icons: { icon: "/brand.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#312e2b",
};

// The puzzle bank self-heal is NOT kicked from here on purpose: layout.tsx is
// compiled for the client bundle too, and bank-bootstrap needs node:child_
// process, which webpack cannot resolve in a browser graph (UnhandledScheme
// 500s on every page). The boot kick lives in src/instrumentation.ts
// (server-only runtime hook), and the puzzle API routes kick the same
// idempotent installer as a backstop on first use.

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
