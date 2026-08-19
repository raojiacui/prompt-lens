import { NextRequest } from "next/server";
import { getAgentStorage } from "@/lib/agent/storage";
import { requireUser, ok, fromError } from "@/lib/agent/api-helpers";
import { retryAgentRun } from "@/lib/agent/service";

// POST /api/agent/runs/:id/retry — 失败后重试（重置失败步骤并继续执行）
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await params;
    const storage = await getAgentStorage();
    const run = await retryAgentRun(storage, userId, id);
    return ok({ run });
  } catch (error) {
    return fromError(error);
  }
}
