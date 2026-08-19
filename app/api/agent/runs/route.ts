import { NextRequest } from "next/server";
import { getAgentStorage } from "@/lib/agent/storage";
import { requireUser, ok, fromError, fail } from "@/lib/agent/api-helpers";
import { createAgentRun, listAgentRuns } from "@/lib/agent/service";

// POST /api/agent/runs — 创建一个新的 agent run 并开始执行
export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireUser(request);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.userGoal !== "string") {
      return fail("userGoal is required", 400, "VALIDATION");
    }

    const storage = await getAgentStorage();
    const run = await createAgentRun(storage, userId, {
      userGoal: body.userGoal as string,
      attachments: Array.isArray(body.attachments) ? (body.attachments as never[]) : undefined,
      provider: typeof body.provider === "string" ? (body.provider as string) : null,
      locale: typeof body.locale === "string" ? (body.locale as string) : undefined,
      autoExecute: body.autoExecute !== false,
    });

    return ok({ run }, { status: 201 });
  } catch (error) {
    return fromError(error);
  }
}

// GET /api/agent/runs — 当前用户最近的 runs
export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "10", 10);

    const storage = await getAgentStorage();
    const runs = await listAgentRuns(storage, userId, limit);

    // 列表只返回摘要字段（不含完整 toolCalls/artifacts，减少 payload）
    const summary = runs.map((r) => ({
      id: r.id,
      goal: r.goal,
      status: r.status,
      taskKind: r.taskKind,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      errorMessage: r.errorMessage,
      stepCount: r.steps.length,
      artifactCount: r.artifacts.length,
    }));

    return ok({ runs: summary });
  } catch (error) {
    return fromError(error);
  }
}
