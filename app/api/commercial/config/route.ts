import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Public feature configuration contains no account information and needs no database query.
export function GET() {
  return NextResponse.json({ commercialConsumptionEnabled: process.env.COMMERCIAL_CONSUMPTION_ENABLED === "true" }, {
    headers: { "Cache-Control": "no-store" },
  });
}
