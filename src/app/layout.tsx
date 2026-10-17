import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/shell/theme-provider";
import { kickBankBootstrap } from "@/lib/server/bank-bootstrap";

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

// The puzzle bank is not part of git; a fresh environment installs it in the
// background (lib/server/bank-bootstrap). The root layout is the earliest
// nodejs-runtime hook every server render passes through, and kick() is
// idempotent and non-blocking, so this both starts the install on a cold
// server and stays a no-op once the bank is present.
if (process.env.NEXT_PHASE !== "phase-production-build") {
  try {
    kickBankBootstrap();
  } catch {
    // best effort only — the puzzle API routes kick as well
  }
}

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
