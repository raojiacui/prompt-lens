import { NextResponse } from "next/server";

// Historical manual orders remain available to administrators for reconciliation.
export async function POST() {
  return NextResponse.json({ error: "Manual payment orders are no longer accepted", code: "MANUAL_PAYMENT_CLOSED" }, { status: 410 });
}
