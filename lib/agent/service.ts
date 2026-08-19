/**
 * Agent service —— 组合 storage / planner / executor，供 API 路由调用。
 * 路由层只做 HTTP 解析与鉴权，业务逻辑集中在这里，便于测试。
 */

import { randomUUID } from "node:crypto";
import type { AgentAttachment, AgentRun, AgentRunDetail, CreateRunInput } from "./types";
import type { AgentStorage } from "./storage";
import { executeRun } from "./executor";
import { AgentError } from "./errors";
import { isRunRunning, requestCancel, startRunInBackground } from "./runtime";
import { checkRateLimit } from "@/lib/utils/rate-limit";

const ALLOWED_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
];
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15MB（base64 data URL 走 JSON，限制小一些）

function now() {
  return new Date().toISOString();
}

function validateAttachments(attachments: unknown): AgentAttachment[] {
  if (!attachments) return [];
  if (!Array.isArray(attachments)) {
    throw new AgentError("VALIDATION", "attachments must be an array", 400);
  }
  return attachments.map((a, i) => {
    if (!a || typeof a !== "object") {
      throw new AgentError("VALIDATION", `attachment[${i}] is invalid`, 400);
    }
    const att = a as Record<string, unknown>;
    const name = typeof att.name === "string" ? att.name : `attachment-${i + 1}`;
    const type = typeof att.type === "string" ? att.type : "application/octet-stream";
    const size = typeof att.size === "number" ? att.size : 0;
    const dataUrl = typeof att.dataUrl === "string" ? att.dataUrl : undefined;
    const frames = Array.isArray(att.frames) ? (att.frames as string[]).filter((f) => typeof f === "string") : undefined;

    if (!ALLOWED_ATTACHMENT_TYPES.includes(type) && !type.startsWith("image/") && !type.startsWith("video/")) {
      throw new AgentError("VALIDATION", `Unsupported attachment type: ${type}`, 400);
    }
    if (size > MAX_ATTACHMENT_BYTES) {
      throw new AgentError("VALIDATION", `Attachment ${name} exceeds 15MB limit`, 400);
    }
    // 视频附件没有 dataUrl（太大），但允许有 frames
    if (type.startsWith("video/") && dataUrl) {
      // 视频不直接传 dataUrl，丢弃以避免请求体过大
      return { id: randomUUID(), name, type, size, frames };
    }
    return { id: randomUUID(), name, type, size, ...(dataUrl ? { dataUrl } : {}), ...(frames ? { frames } : {}) };
  });
}

export async function createAgentRun(
  storage: AgentStorage,
  userId: string,
  input: CreateRunInput & { autoExecute?: boolean }
): Promise<AgentRunDetail> {
  const goal = (input.userGoal || "").trim();
  if (!goal) {
    throw new AgentError("VALIDATION", "userGoal is required", 400);
  }
  if (goal.length > 4000) {
    throw new AgentError("VALIDATION", "userGoal is too long (max 4000 chars)", 400);
  }

  const attachments = validateAttachments(input.attachments);
  const locale = input.locale && (input.locale === "zh" || input.locale === "en") ? input.locale : "en";
  const provider = input.provider ?? null;
  const ts = now();

  const run: AgentRun = {
    id: randomUUID(),
    userId,
    goal,
    status: "queued",
    provider: typeof provider === "string" ? provider : null,
    locale,
    taskKind: null,
    createdAt: ts,
    updatedAt: ts,
    completedAt: null,
    errorMessage: null,
    metadata: {},
    attachments,
    context: {},
  };

  await storage.createRun(run);

  if (input.autoExecute !== false) {
    startRunInBackground(run.id, userId, storage);
  }

  const detail = await storage.getRun(run.id, userId);
  if (!detail) throw new AgentError("INTERNAL", "Failed to load created run", 500);
  return detail;
}

/** 同步执行（用于测试与 ?wait=true） */
export async function executeAgentRun(
  storage: AgentStorage,
  userId: string,
  runId: string,
  opts: { resume?: boolean; wait?: boolean } = {}
): Promise<AgentRunDetail> {
  const existing = await storage.getRun(runId, userId);
  if (!existing) throw new AgentError("NOT_FOUND", "Agent run not found", 404);

  // 速率限制：每分钟最多 10 次执行/继续
  const { allowed, resetIn } = checkRateLimit(`agent-execute:${userId}`, 10, 60_000);
  if (!allowed) {
    throw new AgentError("RATE_LIMITED", "Too many agent executions, please slow down", 429, { retryAfter: Math.ceil(resetIn / 1000) });
  }

  if (opts.wait || !isRunRunning(runId)) {
    // 同步执行：直接 await executor（适合测试与小规模演示）
    return executeRun(runId, storage, { userId, resume: opts.resume });
  }
  // 已在后台运行，直接返回当前状态
  return existing;
}

export async function cancelAgentRun(
  storage: AgentStorage,
  userId: string,
  runId: string
): Promise<AgentRunDetail> {
  const run = await storage.getRun(runId, userId);
  if (!run) throw new AgentError("NOT_FOUND", "Agent run not found", 404);
  if (run.status === "completed" || run.status === "cancelled" || run.status === "failed") {
    return run;
  }
  requestCancel(runId);
  // 标记为 cancelling —— executor 会在下次检查点写入 cancelled
  await storage.updateRun(runId, userId, { status: "cancelled", completedAt: now() });
  const updated = await storage.getRun(runId, userId);
  return updated ?? run;
}

export async function retryAgentRun(
  storage: AgentStorage,
  userId: string,
  runId: string
): Promise<AgentRunDetail> {
  const run = await storage.getRun(runId, userId);
  if (!run) throw new AgentError("NOT_FOUND", "Agent run not found", 404);

  // 把失败步骤重置为 queued，run 状态置为 queued
  for (const step of run.steps) {
    if (step.status === "failed" || step.status === "cancelled") {
      await storage.updateStep(step.id, {
        status: "queued",
        startedAt: null,
        completedAt: null,
        errorMessage: null,
        outputSummary: null,
      });
    }
  }
  await storage.updateRun(runId, userId, {
    status: "queued",
    errorMessage: null,
    completedAt: null,
  });

  startRunInBackground(runId, userId, storage, { resume: true });
  const updated = await storage.getRun(runId, userId);
  return updated ?? run;
}

export async function deleteAgentRun(storage: AgentStorage, userId: string, runId: string): Promise<void> {
  const ok = await storage.deleteRun(runId, userId);
  if (!ok) throw new AgentError("NOT_FOUND", "Agent run not found", 404);
}

export async function listAgentRuns(storage: AgentStorage, userId: string, limit = 10): Promise<AgentRunDetail[]> {
  const n = Math.min(Math.max(limit, 1), 50);
  return storage.listRuns(userId, n);
}

export async function getAgentRun(storage: AgentStorage, userId: string, runId: string): Promise<AgentRunDetail> {
  const run = await storage.getRun(runId, userId);
  if (!run) throw new AgentError("NOT_FOUND", "Agent run not found", 404);
  return run;
}
