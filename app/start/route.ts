import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { welcomeEntryDestination } from "@/lib/auth/welcome-entry";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  const destination = welcomeEntryDestination(Boolean(session?.user));
  return NextResponse.redirect(new URL(destination, request.url));
}
