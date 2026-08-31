import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createProject } from "@/lib/workflow/service";
import { db, projects } from "@/lib/db";
import { desc, eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const requestedLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") || "20", 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(50, requestedLimit))
    : 20;
  const rows = await db
    .select({
      id: projects.id,
      title: projects.title,
      status: projects.status,
      activeVersionId: projects.activeVersionId,
      updatedAt: projects.updatedAt,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(eq(projects.userId, session.user.id))
    .orderBy(desc(projects.updatedAt))
    .limit(limit);
  return NextResponse.json(
    { projects: rows },
    {
      headers: {
        "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
      },
    },
  );
}

function workflowProjectErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|connect|ECONN|database|postgres|fetch failed/i.test(message)) {
    return "项目创建失败：数据库连接超时或不可用，请稍后重试";
  }
  return message || "Project creation failed";
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim() : "Untitled video project";
    const description = typeof body?.description === "string" ? body.description.trim() : undefined;
    const project = await createProject(session.user.id, title, description);
    return NextResponse.json({ project });
  } catch (error) {
    console.error("Workflow project creation error:", error);
    return NextResponse.json({ error: workflowProjectErrorMessage(error) }, { status: 500 });
  }
}
