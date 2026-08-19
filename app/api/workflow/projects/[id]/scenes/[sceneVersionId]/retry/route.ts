import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { retrySceneAnalysis } from "@/lib/workflow/service";
import { parseWorkflowModelSelection } from "@/lib/workflow/model-selection";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sceneVersionId: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, sceneVersionId } = await params;
  const body = await request.json().catch(() => null);
  try {
    const scene = await retrySceneAnalysis({ userId: session.user.id, projectId: id, sceneVersionId, ...parseWorkflowModelSelection(body) });
    return NextResponse.json({ scene });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Scene retry failed" }, { status: 500 });
  }
}
