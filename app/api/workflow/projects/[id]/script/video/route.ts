import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { scriptVideoSettingsSchema } from "@/lib/workflow/script-video-compiler";
import { previewScriptVideo, submitScriptVideo, readScriptVideoJob } from "@/lib/workflow/script-video-generation";
import { scriptError } from "@/lib/workflow/full-video-script-errors";

export const maxDuration = 90;
const headers = { "Cache-Control": "private, no-store" };
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), versionId: z.string().uuid(), revision: z.number().int().positive(), settings: scriptVideoSettingsSchema,
    language: z.enum(["zh", "en"]), editedPrompt: z.string().trim().min(1).max(20480).optional() }).strict(),
  z.object({ action: z.literal("submit"), token: z.string().max(150000), confirmedCost: z.literal(true) }).strict(),
]);
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    SCRIPT_VIDEO_TOO_LONG: "原脚本时间线超过目标时长，请调整脚本或使用逐镜头生成；不会截断脚本。 / The script exceeds the output duration.",
    SCRIPT_VIDEO_PROMPT_TOO_LONG: "提示词超过 20,480 字符，请精简脚本后重试；原稿已保留。 / Prompt exceeds 20,480 characters.",
    SCRIPT_VIDEO_REVIEW_LIMIT: "当前安全审核最多支持 10,000 字符，请精简生成提示词并重新预览；原稿已保留。 / Current safety review accepts up to 10,000 characters.",
    SCRIPT_VIDEO_INCOMPLETE: "请先补全脚本中的镜头内容。 / Complete the scene scripts first.",
    SCRIPT_VIDEO_INVALID_TIMING: "镜头时间点重叠或顺序异常，请检查原始分析。 / Scene timing is invalid.",
    SCRIPT_VIDEO_INVALID_PREVIEW: "预览无效，请重新预览。 / Invalid preview.",
    SCRIPT_VIDEO_PREVIEW_EXPIRED: "预览已过期，请重新预览后确认。 / Preview expired.",
    SCRIPT_VIDEO_KIE_KEY_REQUIRED: "请先在设置中保存自己的 KIE API Key。 / Configure your own KIE API key first.",
    SCRIPT_VIDEO_JOB_NOT_FOUND: "生成任务不存在。 / Generation not found.",
    SCRIPT_VIDEO_CONCURRENCY_LIMIT: "此项目已有两个长视频任务处理中，请先核对已有任务。 / Two video tasks are already processing.",
    SCRIPT_VIDEO_UNAVAILABLE: "长视频模型暂不可用。 / Long-video model unavailable.",
    SCRIPT_VIDEO_PREVIEW_UNAVAILABLE: "提示词预览服务暂不可用。 / Preview unavailable.",
    SCRIPT_VIDEO_SNAPSHOT_EXPIRED: "任务的脚本快照已按保留规则清理，请从生成历史查看结果。 / Script snapshot has expired.",
  };
  if (!messages[code]) return scriptError(error);
  return NextResponse.json({ code, error: messages[code] }, { status: code === "SCRIPT_VIDEO_JOB_NOT_FOUND" ? 404 : code.includes("EXPIRED") || code.includes("LIMIT") ? 409 : 400, headers });
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403, headers });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid video request" }, { status: 400, headers });
  try {
    const { id } = await params; const input = parsed.data;
    const result = input.action === "preview"
      ? await previewScriptVideo({ ...input, userId: session.user.id, projectId: id })
      : await submitScriptVideo(session.user.id, id, input.token);
    return NextResponse.json(result, { headers });
  } catch (error) { return failure(error); }
}
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const generationId = request.nextUrl.searchParams.get("generationId");
  if (!z.string().uuid().safeParse(generationId).success) return NextResponse.json({ error: "Invalid generation" }, { status: 400, headers });
  try {
    const { id } = await params;
    return NextResponse.json(await readScriptVideoJob(session.user.id, id, generationId!), { headers });
  } catch (error) { return failure(error); }
}
