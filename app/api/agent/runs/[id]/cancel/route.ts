import { NextRequest } from "next/server";
import { getAgentStorage } from "@/lib/agent/storage";
import { requireUser, ok, fromError } from "@/lib/agent/api-helpers";
import { cancelAgentRun } from "@/lib/agent/service";

// POST /api/agent/runs/:id/cancel
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await params;
    const storage = await getAgentStorage();
    const run = await cancelAgentRun(storage, userId, id);
    return ok({ run });
  } catch (error) {
    return fromError(error);
  }
}
