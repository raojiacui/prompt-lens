import { NextRequest } from "next/server";
import { getAgentStorage } from "@/lib/agent/storage";
import { requireUser, ok, fromError } from "@/lib/agent/api-helpers";
import { deleteAgentRun, getAgentRun } from "@/lib/agent/service";

// GET /api/agent/runs/:id — run 完整详情（steps/toolCalls/artifacts）
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await params;
    const storage = await getAgentStorage();
    const run = await getAgentRun(storage, userId, id);
    return ok({ run });
  } catch (error) {
    return fromError(error);
  }
}

// DELETE /api/agent/runs/:id
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await params;
    const storage = await getAgentStorage();
    await deleteAgentRun(storage, userId, id);
    return ok({ deleted: true });
  } catch (error) {
    return fromError(error);
  }
}
