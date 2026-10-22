import { after, NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { and, eq, inArray } from "drizzle-orm";
import { commercialTasks, db } from "@/lib/db";
import { commercialConsumptionEnabled } from "@/lib/billing/commercial-analysis";
import { confirmCommercialTaskInTransaction, runCommercialTask } from "@/lib/billing/commercial-task-runner";
import { wakeReconciliationWorker } from "@/lib/billing/reconciliation-worker";
export const maxDuration = 300;
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (!commercialConsumptionEnabled()) return NextResponse.json({ code: "COMMERCIAL_NOT_ENABLED" }, { status: 503 });
  const body = await request.json().catch(() => null);
  const ids = body?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 4 || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) return NextResponse.json({ code: "INVALID_TASKS" }, { status: 400 });
  try {
    const tasks = await db.transaction(async (tx) => {
      const rows = [];
      for (const id of [...ids].sort()) rows.push(await confirmCommercialTaskInTransaction(tx, session.user.id, id));
      return rows;
    });
    if (tasks.some((task) => ["queued", "running", "review"].includes(task.state))) {
      await wakeReconciliationWorker("commercial_confirm");
    }
    const queuedGenerations = tasks.filter((task) => task.state === "queued" && task.kind === "generation");
    await Promise.all(queuedGenerations.map((task) => runCommercialTask(task.id)));
    const queuedAnalysis = tasks.filter((task) => task.state === "queued" && task.kind !== "generation");
    if (queuedAnalysis.length) after(async () => { for (const task of queuedAnalysis) await runCommercialTask(task.id); });
    const current = queuedGenerations.length
      ? await db.select().from(commercialTasks).where(and(eq(commercialTasks.userId, session.user.id), inArray(commercialTasks.id, ids)))
      : tasks;
    return NextResponse.json({ tasks: ids.map((id) => { const t = current.find((task) => task.id === id)!; return { id: t.id, state: t.state, credits: t.credits }; }) });
  } catch (e) { const code = e instanceof Error ? e.message : "TASK_CONFIRMATION_UNKNOWN"; return NextResponse.json({ code: /^[A-Z_]+$/.test(code) ? code : "TASK_CONFIRMATION_UNKNOWN" }, { status: code === "INSUFFICIENT_COMMERCIAL_BALANCE" ? 402 : 409 }); }
}
