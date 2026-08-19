import { z } from "zod";
import type { ToolDefinition } from "../types";
import { logTool, ok, fail } from "./shared";
import { checkRateLimit } from "@/lib/utils/rate-limit";

const inputSchema = z.object({
  prompt: z.string().min(1).max(4000),
  negativePrompt: z.string().max(2000).optional(),
  duration: z.number().int().min(3).max(15).optional(),
  resolution: z.string().max(20).optional(),
  provider: z.enum(["kie"]).optional(),
});

/**
 * call_existing_video_generate_api —— 加分项工具
 *
 * 复用项目已有的视频生成 Provider 抽象（lib/ai/video-provider.ts）：
 *   - 走 getUserProviderApiKey / createVideoProvider，不另起调用逻辑
 *   - 复用 checkRateLimit，遵守与 /api/video-generate 相同的速率限制
 *   - 无 API key 时不报错中断，而是返回一个"去视频生成标签页"的 next action
 *
 * 注意：这是一个有副作用（创建付费生成任务）的工具。Planner 只在用户明确要求
 * "生成视频"时才会把它排进计划；否则只产出 prompt，由前端 next action 触发。
 */
export const callExistingVideoGenerateApiTool: ToolDefinition = {
  name: "call_existing_video_generate_api",
  description:
    "Create a real video-generation task using the existing Kie.ai provider abstraction (reuses API key lookup and rate limits). Only use when the user explicitly asks to generate a video. If no API key is configured, returns a next-action instead of failing.",
  inputSchema,
  async execute(raw, ctx) {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return fail("Invalid input: " + parsed.error.errors[0]?.message);
    logTool(ctx, "call_existing_video_generate_api", "start");

    // 复用现有限制：每分钟 3 次
    const { allowed, resetIn } = checkRateLimit(`agent-video-gen:${ctx.userId}`, 3, 60_000);
    if (!allowed) {
      return ok(
        { created: false, reason: "rate_limited", retryAfter: Math.ceil(resetIn / 1000) },
        "Video generation rate limit reached; try again shortly."
      );
    }

    try {
      const [providerMod, keyMod] = await Promise.all([
        import("@/lib/ai/video-provider"),
        import("@/lib/ai/video-generator"),
      ]);
      const providerName = parsed.data.provider || providerMod.DEFAULT_VIDEO_PROVIDER;
      const userKey = await keyMod.getUserProviderApiKey(ctx.userId, providerName);
      const effectiveKey = userKey || process.env.KIE_API_KEY;

      if (!effectiveKey) {
        const nextAction = {
          created: false,
          reason: "no_api_key",
          nextAction: {
            label: "Configure Kie API key & generate",
            action: "open_tab",
            tab: "settings",
            description: "Add a Kie.ai API key in Settings, then generate from the Video Generate tab.",
          },
        };
        await ctx.saveArtifact({ type: "other", title: "Video Generation (needs API key)", content: nextAction, metadata: {} });
        return ok(nextAction, "No video API key configured; added a next-action.");
      }

      const provider = providerMod.createVideoProvider(providerName, effectiveKey);
      const result = await provider.createTask({
        prompt: parsed.data.prompt,
        negativePrompt: parsed.data.negativePrompt,
        duration: parsed.data.duration ?? 5,
        resolution: parsed.data.resolution ?? "720p",
      });

      const output = {
        created: true,
        taskId: result.taskId,
        provider: providerName,
        pollEndpoint: `/api/video-generate?taskId=${result.taskId}`,
        nextAction: {
          label: "Track video generation",
          action: "open_tab",
          tab: "video-gen",
          description: "Open the Video Generate tab to track this task's progress.",
        },
      };
      await ctx.saveArtifact({ type: "other", title: "Video Generation Task", content: output, metadata: { taskId: result.taskId, provider: providerName } });

      logTool(ctx, "call_existing_video_generate_api", "done", { taskId: result.taskId });
      return ok(output, `Created video task ${result.taskId} via ${providerName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Video generation failed";
      logTool(ctx, "call_existing_video_generate_api", "error", message);
      return ok({ created: false, reason: message }, "Video generation failed; the rest of the run continues.");
    }
  },
};
