import { NextRequest } from "next/server";
import { getAgentStorage } from "@/lib/agent/storage";
import { requireUser, ok, fromError } from "@/lib/agent/api-helpers";
import { executeAgentRun } from "@/lib/agent/service";

// POST /api/agent/runs/:id/execute — 执行或继续执行
//   ?wait=true   同步执行并返回最终 run（测试/小数据量）
//   默认          后台执行，立即返回当前 run
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireUser(request);
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const wait = searchParams.get("wait") === "true";
    const body = (await request.json().catch(() => ({}))) as { resume?: boolean };

    const storage = await getAgentStorage();
    const run = await executeAgentRun(storage, userId, id, { wait, resume: body.resume !== false });
    return ok({ run });
  } catch (error) {
    return fromError(error);
  }
}
