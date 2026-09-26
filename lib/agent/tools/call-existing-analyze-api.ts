import { z } from "zod";
import type { ToolDefinition } from "../types";
import { logTool, ok, fail } from "./shared";

const inputSchema = z.object({});

/**
 * call_existing_analyze_api —— 加分项工具
 *
 * 复用项目已有的视频/图片分析能力（lib/ai/analyzer.ts 的 analyzeFrames），
 * 不重新实现分析逻辑。遵守已有规则：
 *   - 需要客户端提取的帧（base64）；附件为图片时用 dataUrl，视频时用 attachment.frames
 *   - 无 API key 时 analyzeFrames 返回 success:false，本工具把它转成"需要在 Analyze 标签页手动分析"的 next action，而不是让整个 run 失败
 *   - 不绕过任何限制（帧数、provider 由调用方决定）
 */
export const callExistingAnalyzeApiTool: ToolDefinition = {
  name: "call_existing_analyze_api",
  description:
    "Reuse Prompt Lens' existing visual analysis on an attached image or extracted video frames. Produces a detailed analysis and reusable prompt. If no media/frames or no API key, returns a next-action instead of failing.",
  inputSchema,
  async execute(raw, ctx) {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return fail("Invalid input: " + parsed.error.errors[0]?.message);
    logTool(ctx, "call_existing_analyze_api", "start");

    const imageAttachments = ctx.attachments.filter((a) => a.type.startsWith("image/"));
    const videoAttachments = ctx.attachments.filter((a) => a.type.startsWith("video/"));

    // 收集可用帧
    const frames: string[] = [];
    for (const img of imageAttachments) {
      if (img.dataUrl) frames.push(img.dataUrl);
    }
    for (const vid of videoAttachments) {
      if (vid.frames && vid.frames.length > 0) frames.push(...vid.frames);
    }

    if (frames.length === 0) {
      const nextAction = {
        analyzed: false,
        reason:
          "No client-extracted frames available. Open the Analyze tab, upload the media and extract frames, then re-run, or attach a smaller image.",
        nextAction: {
          label: "Open Analyze tab",
          action: "open_tab",
          tab: "analyze",
          description: "Upload the media there to extract frames and run full visual analysis.",
        },
      };
      await ctx.saveArtifact({ type: "other", title: "Visual Analysis (deferred)", content: nextAction, metadata: { deferred: true } });
      return ok(nextAction, "No frames available; added a next-action to analyze manually.");
    }

    let trialReservationId: string | null = null;
    let trialCompleted = false;
    try {
      // 动态导入，保持工具注册表在无 analyzer 依赖时仍可加载
      const { analyzeFrames } = await import("@/lib/ai/analyzer");
      const { assertCanStartVideoAnalysis, FREE_TRIAL_ANALYSIS_MODEL, settleVideoAnalysisCredits } = await import("@/lib/billing/video-analysis");
      const { reserveTrialAnalysis, completeTrialAnalysis } = await import("@/lib/usage/trial-quota");
      const { getPlatformKieApiKey, resolveKieApiKeyForFeature } = await import("@/lib/billing/platform-access");
      const { db, analysisHistory, operationLogs } = await import("@/lib/db");
      const entitlement = await assertCanStartVideoAnalysis(ctx.userId, 1);
      const apiKey = entitlement.mode === "trial"
        ? getPlatformKieApiKey()
        : (await resolveKieApiKeyForFeature(ctx.userId, { requiredPackageScope: "video_analysis" })).apiKey;
      if (!apiKey) throw new Error("KIE API Key is not configured");
      if (entitlement.mode === "trial") {
        trialReservationId = await reserveTrialAnalysis(ctx.userId);
      }
      const provider = "kie";
      const result = await analyzeFrames({
        userId: ctx.userId,
        provider,
        frames: frames.slice(0, 12),
        mode: "single",
        outputLanguage: (ctx.locale === "zh" ? "zh" : "en") as "zh" | "en",
        apiKeyOverride: apiKey,
        modelId: entitlement.mode === "trial" ? FREE_TRIAL_ANALYSIS_MODEL : undefined,
      });

      if (!result.success) {
        const fallback = {
          analyzed: false,
          reason: result.error || "Analysis failed",
          nextAction: {
            label: "Configure API key & analyze",
            action: "open_tab",
            tab: "settings",
            description: "Add a provider API key in Settings, then analyze the media in the Analyze tab.",
          },
        };
        await ctx.saveArtifact({ type: "other", title: "Visual Analysis (needs API key)", content: fallback, metadata: { deferred: true } });
        return ok(fallback, "Analysis unavailable (no API key); added a next-action.");
      }

      await db.insert(analysisHistory).values({
        userId: ctx.userId,
        mediaType: videoAttachments.length ? "video" : "image",
        mediaName: ctx.attachments[0]?.name || "Agent attachment",
        frameCount: frames.length,
        analyzeMode: "single",
        prompt: result.prompt!,
        corePrompt: result.corePrompt,
        language: ctx.locale === "zh" ? "zh" : "en",
      });
      await settleVideoAnalysisCredits({ userId: ctx.userId, entitlement, units: 1, metadata: { agentRunId: ctx.runId } });
      await db.insert(operationLogs).values({
        userId: ctx.userId,
        action: "analysis.complete",
        resourceType: videoAttachments.length ? "video" : "image",
        metadata: { billingMode: entitlement.mode, provider: "kie", agentRunId: ctx.runId, trialReservationId },
      });
      await completeTrialAnalysis(trialReservationId);
      trialCompleted = true;

      const analysis = {
        analyzed: true,
        prompt: result.prompt,
        corePrompt: result.corePrompt,
        frameCount: frames.length,
        provider,
      };
      ctx.sharedContext.analysis = analysis;
      await ctx.saveArtifact({ type: "other", title: "Visual Analysis", content: analysis, metadata: { frameCount: frames.length, provider } });

      logTool(ctx, "call_existing_analyze_api", "done");
      return ok(analysis, `Analyzed ${frames.length} frame(s) and extracted a reusable prompt.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analysis error";
      logTool(ctx, "call_existing_analyze_api", "error", message);
      // 不因为分析失败而让整个 run 失败
      return ok({ analyzed: false, reason: message }, "Analysis could not run; continuing with the rest of the plan.");
    } finally {
      if (trialReservationId && !trialCompleted) {
        const { releaseTrialAnalysis } = await import("@/lib/usage/trial-quota");
        await releaseTrialAnalysis(trialReservationId).catch((error) => console.error("Failed to release trial reservation:", error));
      }
    }
  },
};
