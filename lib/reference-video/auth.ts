import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function requireReferenceVideoUser(headers: Headers) {
  const session = await auth.api.getSession({
    headers,
  });
  const user = session?.user;

  if (!user) {
    return {
      user: null,
      response: NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 },
      ),
    } as const;
  }

  return { user, response: null } as const;
}
