import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createRemixVersion } from "@/lib/workflow/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const sourceVersionId = typeof body?.sourceVersionId === "string" ? body.sourceVersionId : "";
  const remixPrompt = typeof body?.remixPrompt === "string" ? body.remixPrompt.trim() : "";
  if (!sourceVersionId || !remixPrompt) {
    return NextResponse.json({ error: "Missing sourceVersionId or remixPrompt" }, { status: 400 });
  }

  try {
    const { id } = await params;
    const bundle = await createRemixVersion({ userId: session.user.id, projectId: id, sourceVersionId, remixPrompt });
    return NextResponse.json(bundle);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Remix failed" }, { status: 500 });
  }
}