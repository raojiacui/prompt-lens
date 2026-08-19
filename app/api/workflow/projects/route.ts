import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createProject } from "@/lib/workflow/service";
import { db, projects } from "@/lib/db";
import { desc, eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.query.projects.findMany({
    where: eq(projects.userId, session.user.id),
    orderBy: [desc(projects.updatedAt)],
    limit: 50,
  });
  return NextResponse.json({ projects: rows });
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim() : "Untitled video project";
  const description = typeof body?.description === "string" ? body.description.trim() : undefined;
  const project = await createProject(session.user.id, title, description);
  return NextResponse.json({ project });
}