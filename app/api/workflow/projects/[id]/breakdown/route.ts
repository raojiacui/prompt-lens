import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runVideoBreakdown } from "@/lib/workflow/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const mediaUrl = typeof body?.mediaUrl === "string" ? body.mediaUrl.trim() : "";
  if (!mediaUrl) return NextResponse.json({ error: "Missing mediaUrl" }, { status: 400 });

  try {
    const { id } = await params;
    const bundle = await runVideoBreakdown({
      userId: session.user.id,
      projectId: id,
      mediaUrl,
      mediaName: typeof body?.mediaName === "string" ? body.mediaName : undefined,
      storageKey: typeof body?.storageKey === "string" ? body.storageKey : undefined,
    });
    return NextResponse.json(bundle);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Breakdown failed" }, { status: 500 });
  }
}