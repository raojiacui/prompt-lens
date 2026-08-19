import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rewriteSceneVersion } from "@/lib/workflow/service";
import { parseWorkflowModelSelection } from "@/lib/workflow/model-selection";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sceneVersionId: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, sceneVersionId } = await params;
  const body = await request.json().catch(() => null);
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  if (!instruction) return NextResponse.json({ error: "Missing rewrite instruction" }, { status: 400 });

  try {
    const scene = await rewriteSceneVersion({ userId: session.user.id, projectId: id, sceneVersionId, instruction, ...parseWorkflowModelSelection(body) });
    return NextResponse.json({ scene });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Scene rewrite failed" }, { status: 500 });
  }
}
