import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { randomBytes } from "crypto";
import { auth } from "@/lib/auth";
import { db, dailyVisits } from "@/lib/db";

const SESSION_COOKIE = "pl_session_id";
const SESSION_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  try {
    const headersList = await headers();
    const cookieStore = await cookies();
    const session = await auth.api.getSession({ headers: headersList }).catch(() => null);

    let sessionId = cookieStore.get(SESSION_COOKIE)?.value;
    if (!sessionId) {
      sessionId = randomBytes(32).toString("hex");
      cookieStore.set(SESSION_COOKIE, sessionId, {
        path: "/",
        maxAge: SESSION_MAX_AGE,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        httpOnly: false, // allow client-side reuse if needed
      });
    }

    const body = await request.json().catch(() => ({ path: "/" }));
    const path = typeof body.path === "string" ? body.path : "/";

    await db.insert(dailyVisits).values({
      date: getTodayKey(),
      sessionId,
      userId: session?.user?.id || null,
      ipAddress: headersList.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
      userAgent: headersList.get("user-agent") || "unknown",
      path,
    }).onConflictDoNothing({ target: [dailyVisits.date, dailyVisits.sessionId] });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Visit tracking error:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
