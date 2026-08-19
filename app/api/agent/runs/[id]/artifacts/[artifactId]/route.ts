import { NextRequest } from "next/server";
import { getAgentStorage } from "@/lib/agent/storage";
import { requireUser, ok, fromError, fail } from "@/lib/agent/api-helpers";
import { getAgentRun } from "@/lib/agent/service";

// PATCH /api/agent/runs/:id/artifacts/:artifactId — 例如标记 favorite
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  try {
    const { userId } = await requireUser(request);
    const { id, artifactId } = await params;
    const body = (await request.json().catch(() => ({}))) as { favorite?: boolean };

    const storage = await getAgentStorage();
    // 先校验 run 归属
    await getAgentRun(storage, userId, id);

    const updated = await storage.updateArtifact(artifactId, {
      ...(typeof body.favorite === "boolean" ? { favorite: body.favorite } : {}),
    });
    if (!updated) return fail("Artifact not found", 404, "NOT_FOUND");
    return ok({ artifact: updated });
  } catch (error) {
    return fromError(error);
  }
}
