import { NextResponse } from "next/server";

// Lightweight liveness probe for the dev-server watchdog
// (scripts/dev-watchdog.sh). Must stay dependency-free and instant:
// a health check that compiles pages would itself create memory pressure.
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}
