import { NextRequest, NextResponse } from "next/server";
import { getAdminUserFromHeaders } from "@/lib/auth";
import { queryFinancialEntries } from "@/lib/admin/credit-audit";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await getAdminUserFromHeaders(request.headers)) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const { id } = await params;
  const kind = request.nextUrl.searchParams.get("kind") || "orders";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !["orders","ledger"].includes(kind)) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  const bounded = (key: string, fallback: number, max: number) => {
    const n = Number(request.nextUrl.searchParams.get(key) || fallback);
    return Number.isFinite(n) ? Math.max(1,Math.min(max,Math.floor(n))) : fallback;
  };
  try {
    return NextResponse.json(await queryFinancialEntries(id, kind as "orders" | "ledger", bounded("page",1,100000), bounded("limit",20,100)), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Financial records unavailable" }, { status: 503 });
  }
}
