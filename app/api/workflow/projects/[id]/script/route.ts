import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { scriptContentSchema, exportFullVideoScript } from "@/lib/workflow/full-video-script";
import { readFullVideoScript, saveFullVideoScript } from "@/lib/workflow/full-video-script-store";

import { scriptError } from "@/lib/workflow/full-video-script-errors";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const versionId = request.nextUrl.searchParams.get("versionId");
  if (!z.string().uuid().safeParse(versionId).success) return NextResponse.json({ error: "Invalid version" }, { status: 400, headers });
  try {
    const { id } = await params;
    const zh = request.nextUrl.searchParams.get("language") !== "en";
    const document = await readFullVideoScript(session.user.id, id, versionId!, zh);
    const format = request.nextUrl.searchParams.get("format");
    if (format) {
      if (!["md", "txt", "json"].includes(format)) return NextResponse.json({ error: "Invalid format" }, { status: 400, headers });
      if (Number(request.nextUrl.searchParams.get("revision")) !== document.revision) throw new Error("SCRIPT_CONFLICT");
      return new NextResponse(exportFullVideoScript(document.content, format as "md" | "txt" | "json", id, versionId!, document.revision, zh), {
        headers: { ...headers, "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="full-video-script-r${document.revision}.${format}"`, "X-Content-Type-Options": "nosniff" },
      });
    }
    return NextResponse.json(document, { headers });
  } catch (error) { return scriptError(error); }
}
const updateSchema = z.object({ versionId: z.string().uuid(), revision: z.number().int().positive(),
  action: z.enum(["save", "apply", "undo"]), content: scriptContentSchema.optional(), candidateId: z.string().uuid().optional() }).strict();
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403, headers });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.action === "save" && !parsed.data.content || parsed.data.action === "apply" && !parsed.data.candidateId) return NextResponse.json({ error: "Invalid script update" }, { status: 400, headers });
  try {
    const { id } = await params;
    const body = parsed.data;
    return NextResponse.json(await saveFullVideoScript({ userId: session.user.id, projectId: id, versionId: body.versionId, revision: body.revision,
      ...(body.action === "save" ? { content: body.content } : body.action === "apply" ? { candidateId: body.candidateId } : { undo: true }) }), { headers });
  } catch (error) { return scriptError(error); }
}
