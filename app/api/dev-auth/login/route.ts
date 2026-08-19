import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";

export const runtime = "nodejs";

const DEV_AUTH_COOKIE = "prompt-lens.dev_user_id";
const DEV_USER_ID = "00000000-0000-4000-8000-000000000001";

export async function POST() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  const existing = await db.query.user.findFirst({
    where: eq(user.id, DEV_USER_ID),
  });

  if (!existing) {
    await db.insert(user).values({
      id: DEV_USER_ID,
      email: "local-dev@prompt-lens.test",
      emailVerified: true,
      name: "Local Dev",
      role: "user",
      isAnonymous: false,
    });
  }

  const response = NextResponse.json({
    success: true,
    user: {
      id: DEV_USER_ID,
      email: "local-dev@prompt-lens.test",
      name: "Local Dev",
    },
  });

  response.cookies.set(DEV_AUTH_COOKIE, DEV_USER_ID, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}