import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProjectBundle } from "@/lib/workflow/service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const bundle = await getProjectBundle(id, session.user.id);
  if (!bundle) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json(bundle);
}