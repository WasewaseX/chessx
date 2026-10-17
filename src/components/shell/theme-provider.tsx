"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

// attribute="class" puts .dark on <html> so every themed surface (including
// native scrollbars and form controls via color-scheme) follows one switch.
// System is enabled so the sidebar toggle and Settings can offer
// light / dark / system; the resolved class is applied by next-themes.
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
