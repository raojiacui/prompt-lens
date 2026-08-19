/**
 * Agent Run 持久化层
 *
 * - 定义统一的 AgentStorage 接口（planner/executor 只依赖这个接口）
 * - 提供三种实现：
 *   1. InMemoryAgentStorage —— 仅用于测试
 *   2. JsonFileAgentStorage —— 无数据库时的 fallback，数据写入 .data/agent/
 *   3. DrizzleAgentStorage —— 复用项目已有的 Postgres + Drizzle
 *
 * 通过 getAgentStorage() 在首次调用时探测一次：
 *   - 配置了 DATABASE_URL 且可连通 → Drizzle
 *   - 否则 → JSON 文件
 * 这样即使数据库不可用，整个 Agent 功能仍可演示，页面不会崩溃。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type {
  AgentArtifact,
  AgentRun,
  AgentRunDetail,
  AgentStep,
  AgentToolCall,
} from "./types";

// Drizzle 表对象通过 `schema` 命名空间在各方法内部以 `const s = schema` 使用，
// 这里不做解构（schema.ts 不建立数据库连接，可安全静态引入）。

// ============ 存储接口 ============

export interface AgentStorage {
  readonly kind: "memory" | "json" | "drizzle";

  createRun(run: AgentRun): Promise<AgentRun>;
  getRun(runId: string, userId: string): Promise<AgentRunDetail | null>;
  listRuns(userId: string, limit?: number): Promise<AgentRunDetail[]>;
  updateRun(runId: string, userId: string, patch: Partial<AgentRun>): Promise<AgentRunDetail | null>;
  deleteRun(runId: string, userId: string): Promise<boolean>;

  createSteps(steps: AgentStep[]): Promise<void>;
  updateStep(stepId: string, patch: Partial<AgentStep>): Promise<AgentStep | null>;

  createToolCall(call: AgentToolCall): Promise<AgentToolCall>;
  updateToolCall(callId: string, patch: Partial<AgentToolCall>): Promise<AgentToolCall | null>;

  createArtifact(artifact: AgentArtifact): Promise<AgentArtifact>;
  updateArtifact(artifactId: string, patch: Partial<AgentArtifact>): Promise<AgentArtifact | null>;

  /** 查找当前用户历史（analysis_history / video_generation）中相关记录 */
  findRelevantHistory(
    userId: string,
    query: string,
    limit?: number
  ): Promise<Array<{ id: string; title: string; snippet: string; createdAt: string }>>;
}

// ============ 内存实现（测试用） ============

export class InMemoryAgentStorage implements AgentStorage {
  readonly kind = "memory" as const;
  runs = new Map<string, AgentRun>();
  steps = new Map<string, AgentStep>();
  toolCalls = new Map<string, AgentToolCall>();
  artifacts = new Map<string, AgentArtifact>();

  private ownRun(runId: string, userId: string): AgentRun | null {
    const run = this.runs.get(runId);
    return run && run.userId === userId ? run : null;
  }

  async createRun(run: AgentRun) {
    this.runs.set(run.id, { ...run });
    return run;
  }

  async getRun(runId: string, userId: string): Promise<AgentRunDetail | null> {
    const run = this.ownRun(runId, userId);
    if (!run) return null;
    return this.assemble(run);
  }

  async listRuns(userId: string, limit = 10): Promise<AgentRunDetail[]> {
    return Array.from(this.runs.values())
      .filter((r) => r.userId === userId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit)
      .map((r) => this.assemble(r));
  }

  async updateRun(runId: string, userId: string, patch: Partial<AgentRun>) {
    const run = this.ownRun(runId, userId);
    if (!run) return null;
    Object.assign(run, patch, { updatedAt: new Date().toISOString() });
    return this.assemble(run);
  }

  async deleteRun(runId: string, userId: string) {
    const run = this.ownRun(runId, userId);
    if (!run) return false;
    this.runs.delete(runId);
    for (const [id, s] of this.steps) if (s.runId === runId) this.steps.delete(id);
    for (const [id, c] of this.toolCalls) if (c.runId === runId) this.toolCalls.delete(id);
    for (const [id, a] of this.artifacts) if (a.runId === runId) this.artifacts.delete(id);
    return true;
  }

  async createSteps(steps: AgentStep[]) {
    steps.forEach((s) => this.steps.set(s.id, { ...s }));
  }

  async updateStep(stepId: string, patch: Partial<AgentStep>) {
    const step = this.steps.get(stepId);
    if (!step) return null;
    Object.assign(step, patch);
    return step;
  }

  async createToolCall(call: AgentToolCall) {
    this.toolCalls.set(call.id, { ...call });
    return call;
  }

  async updateToolCall(callId: string, patch: Partial<AgentToolCall>) {
    const call = this.toolCalls.get(callId);
    if (!call) return null;
    Object.assign(call, patch);
    return call;
  }

  async createArtifact(artifact: AgentArtifact) {
    this.artifacts.set(artifact.id, { ...artifact });
    return artifact;
  }

  async updateArtifact(artifactId: string, patch: Partial<AgentArtifact>) {
    const art = this.artifacts.get(artifactId);
    if (!art) return null;
    Object.assign(art, patch);
    return art;
  }

  async findRelevantHistory() {
    return [];
  }

  private assemble(run: AgentRun): AgentRunDetail {
    return {
      ...run,
      steps: Array.from(this.steps.values())
        .filter((s) => s.runId === run.id)
        .sort((a, b) => a.order - b.order),
      toolCalls: Array.from(this.toolCalls.values()).filter((c) => c.runId === run.id),
      artifacts: Array.from(this.artifacts.values())
        .filter((a) => a.runId === run.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    };
  }
}

// ============ JSON 文件实现（无数据库 fallback） ============

type RunFile = AgentRunDetail;

function atomicWriteJson(file: string, data: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  const payload = JSON.stringify(data, null, 2);
  writeFileSync(tmp, payload, "utf8");
  // rename 在同一文件系统上是原子操作，避免读到半截 JSON
  try {
    renameSync(tmp, file);
  } catch {
    // 兜底：个别挂载层 rename 受限时直接覆盖写
    writeFileSync(file, payload, "utf8");
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function safeReadJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export class JsonFileAgentStorage implements AgentStorage {
  readonly kind = "json" as const;
  private readonly root: string;

  constructor(root?: string) {
    this.root = root || join(process.cwd(), ".data", "agent");
    mkdirSync(this.root, { recursive: true });
  }

  private userDir(userId: string) {
    return join(this.root, "users", userId);
  }

  private runFile(userId: string, runId: string) {
    return join(this.userDir(userId), "runs", `${runId}.json`);
  }

  private indexFile(userId: string) {
    return join(this.userDir(userId), "index.json");
  }

  private writeIndex(userId: string, detail: AgentRunDetail) {
    const index = safeReadJson<
      Array<{
        id: string;
        goal: string;
        status: string;
        taskKind: string | null;
        createdAt: string;
        completedAt: string | null;
        errorMessage: string | null;
      }>
    >(this.indexFile(userId), []);
    const existing = index.findIndex((r) => r.id === detail.id);
    const summary = {
      id: detail.id,
      goal: detail.goal,
      status: detail.status,
      taskKind: detail.taskKind,
      createdAt: detail.createdAt,
      completedAt: detail.completedAt,
      errorMessage: detail.errorMessage,
    };
    if (existing >= 0) index[existing] = summary;
    else index.unshift(summary);
    index.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    atomicWriteJson(this.indexFile(userId), index.slice(0, 50));
  }

  async createRun(run: AgentRun) {
    const detail: RunFile = { ...run, steps: [], toolCalls: [], artifacts: [] };
    atomicWriteJson(this.runFile(run.userId, run.id), detail);
    this.writeIndex(run.userId, detail);
    return run;
  }

  async getRun(runId: string, userId: string): Promise<AgentRunDetail | null> {
    return safeReadJson<RunFile | null>(this.runFile(userId, runId), null);
  }

  async listRuns(userId: string, limit = 10): Promise<AgentRunDetail[]> {
    const index = safeReadJson<Array<{ id: string }>>(this.indexFile(userId), []);
    const details: AgentRunDetail[] = [];
    for (const item of index.slice(0, limit)) {
      const d = await this.getRun(item.id, userId);
      if (d) details.push(d);
    }
    return details;
  }

  async updateRun(runId: string, userId: string, patch: Partial<AgentRun>) {
    const detail = await this.getRun(runId, userId);
    if (!detail) return null;
    Object.assign(detail, patch, { updatedAt: new Date().toISOString() });
    atomicWriteJson(this.runFile(userId, runId), detail);
    this.writeIndex(userId, detail);
    return detail;
  }

  async deleteRun(runId: string, userId: string) {
    const file = this.runFile(userId, runId);
    if (!existsSync(file)) return false;
    rmSync(file, { force: true });
    const index = safeReadJson<Array<{ id: string }>>(this.indexFile(userId), []);
    atomicWriteJson(
      this.indexFile(userId),
      index.filter((r) => r.id !== runId)
    );
    return true;
  }

  async createSteps(steps: AgentStep[]) {
    if (steps.length === 0) return;
    // 所有 step 属于同一 run，先定位一次 run 文件
    const located = await this.findRunFileById(steps[0].runId);
    if (!located) return;
    const d = located.detail;
    for (const step of steps) {
      d.steps = d.steps.filter((s) => s.id !== step.id);
      d.steps.push(step);
    }
    d.steps.sort((a, b) => a.order - b.order);
    atomicWriteJson(located.file, d);
  }

  async updateStep(stepId: string, patch: Partial<AgentStep>) {
    const located = await this.findRunFileByStepId(stepId);
    if (!located) return null;
    const d = located.detail;
    const step = d.steps.find((s) => s.id === stepId);
    if (!step) return null;
    Object.assign(step, patch);
    atomicWriteJson(located.file, d);
    return step;
  }

  async createToolCall(call: AgentToolCall) {
    const located = await this.findRunFileById(call.runId);
    if (!located) return call;
    const d = located.detail;
    d.toolCalls = d.toolCalls.filter((c) => c.id !== call.id);
    d.toolCalls.push(call);
    atomicWriteJson(located.file, d);
    return call;
  }

  async updateToolCall(callId: string, patch: Partial<AgentToolCall>) {
    const located = await this.findRunFileByToolCallId(callId);
    if (!located) return null;
    const d = located.detail;
    const call = d.toolCalls.find((c) => c.id === callId);
    if (!call) return null;
    Object.assign(call, patch);
    atomicWriteJson(located.file, d);
    return call;
  }

  async createArtifact(artifact: AgentArtifact) {
    const located = await this.findRunFileById(artifact.runId);
    if (located) {
      const d = located.detail;
      d.artifacts = d.artifacts.filter((a) => a.id !== artifact.id);
      d.artifacts.push(artifact);
      atomicWriteJson(located.file, d);
    }
    return artifact;
  }

  async updateArtifact(artifactId: string, patch: Partial<AgentArtifact>) {
    for await (const detail of this.iterAllRuns()) {
      const art = detail.artifacts.find((a) => a.id === artifactId);
      if (art) {
        Object.assign(art, patch);
        atomicWriteJson(this.runFile(detail.userId, detail.id), detail);
        return art;
      }
    }
    return null;
  }

  async findRelevantHistory() {
    // JSON 存储不持有 analysis/history 数据；返回空数组，由工具层提供 mock 建议。
    return [];
  }

  // ----- 内部：按 runId 反查文件（fallback 场景数据量小，可接受扫描） -----

  private async *iterAllRuns(): AsyncGenerator<AgentRunDetail & { userId: string }> {
    const usersDir = join(this.root, "users");
    if (!existsSync(usersDir)) return;
    for (const userId of readdirSync(usersDir)) {
      const runsDir = join(usersDir, userId, "runs");
      if (!existsSync(runsDir)) continue;
      for (const file of readdirSync(runsDir)) {
        if (!file.endsWith(".json")) continue;
        const d = safeReadJson<AgentRunDetail | null>(join(runsDir, file), null);
        if (d) yield { ...d, userId };
      }
    }
  }

  private async findRunFileById(runId: string): Promise<{ file: string; detail: AgentRunDetail; userId: string } | null> {
    const usersDir = join(this.root, "users");
    if (!existsSync(usersDir)) return null;
    for (const userId of readdirSync(usersDir)) {
      const file = join(usersDir, userId, "runs", `${runId}.json`);
      if (existsSync(file)) {
        const d = safeReadJson<AgentRunDetail | null>(file, null);
        if (d) return { file, detail: d, userId };
      }
    }
    return null;
  }

  private async findRunFileByStepId(stepId: string) {
    for await (const d of this.iterAllRuns()) {
      if (d.steps.some((s) => s.id === stepId)) {
        return { file: this.runFile(d.userId, d.id), detail: d };
      }
    }
    return null;
  }

  private async findRunFileByToolCallId(callId: string) {
    for await (const d of this.iterAllRuns()) {
      if (d.toolCalls.some((c) => c.id === callId)) {
        return { file: this.runFile(d.userId, d.id), detail: d };
      }
    }
    return null;
  }
}

// ============ Drizzle 实现（复用项目 Postgres） ============

type DrizzleDb = typeof import("@/lib/db").db;

export class DrizzleAgentStorage implements AgentStorage {
  readonly kind = "drizzle" as const;
  constructor(private readonly db: DrizzleDb) {}

  async createRun(run: AgentRun) {
    const s = schema;
    await this.db.insert(s.agentRuns).values({
      id: run.id,
      userId: run.userId,
      goal: run.goal,
      status: run.status,
      provider: run.provider,
      locale: run.locale,
      taskKind: run.taskKind,
      errorMessage: run.errorMessage,
      metadata: run.metadata,
      attachments: run.attachments as unknown as Record<string, unknown>[],
      context: run.context as Record<string, unknown>,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      completedAt: run.completedAt,
    } as never);
    return run;
  }

  async getRun(runId: string, userId: string): Promise<AgentRunDetail | null> {
    const s = schema;
    const runRow = await this.db.query.agentRuns.findFirst({
      where: eq(s.agentRuns.id, runId),
    });
    if (!runRow || (runRow as { userId: string }).userId !== userId) return null;
    return this.assemble(runRow as never, userId);
  }

  async listRuns(userId: string, limit = 10): Promise<AgentRunDetail[]> {
    const s = schema;
    const rows = await this.db.query.agentRuns.findMany({
      where: eq(s.agentRuns.userId, userId) as never,
      orderBy: desc(s.agentRuns.createdAt) as never,
      limit,
    });
    const out: AgentRunDetail[] = [];
    for (const r of rows as unknown as Array<Record<string, unknown>>) {
      out.push(await this.assemble(r as never, userId));
    }
    return out;
  }

  async updateRun(runId: string, userId: string, patch: Partial<AgentRun>) {
    const s = schema;
    const existing = await this.getRun(runId, userId);
    if (!existing) return null;
    await this.db
      .update(s.agentRuns)
      .set(this.mapRunPatch(patch))
      .where(eq(s.agentRuns.id, runId) as never);
    return this.getRun(runId, userId);
  }

  async deleteRun(runId: string, userId: string) {
    const s = schema;
    const existing = await this.db.query.agentRuns.findFirst({ where: eq(s.agentRuns.id, runId) as never });
    if (!existing || (existing as { userId: string }).userId !== userId) return false;
    await this.db.delete(s.agentArtifacts).where(eq(s.agentArtifacts.runId, runId) as never);
    await this.db.delete(s.agentToolCalls).where(eq(s.agentToolCalls.runId, runId) as never);
    await this.db.delete(s.agentSteps).where(eq(s.agentSteps.runId, runId) as never);
    await this.db.delete(s.agentRuns).where(and(eq(s.agentRuns.id, runId), eq(s.agentRuns.userId, userId)) as never);
    return true;
  }

  async createSteps(steps: AgentStep[]) {
    if (steps.length === 0) return;
    const s = schema;
    await this.db.insert(s.agentSteps).values(
      steps.map((step) => ({
        id: step.id,
        runId: step.runId,
        order: step.order,
        title: step.title,
        description: step.description,
        status: step.status,
        toolName: step.toolName,
        expectedOutput: step.expectedOutput,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        errorMessage: step.errorMessage,
        outputSummary: step.outputSummary,
      })) as never
    );
  }

  async updateStep(stepId: string, patch: Partial<AgentStep>) {
    const s = schema;
    await this.db
      .update(s.agentSteps)
      .set(this.mapStepPatch(patch))
      .where(eq(s.agentSteps.id, stepId) as never);
    const row = await this.db.query.agentSteps.findFirst({ where: eq(s.agentSteps.id, stepId) as never });
    return row ? this.normalizeStep(row as never) : null;
  }

  async createToolCall(call: AgentToolCall) {
    const s = schema;
    await this.db.insert(s.agentToolCalls).values({
      id: call.id,
      runId: call.runId,
      stepId: call.stepId,
      toolName: call.toolName,
      status: call.status,
      input: call.input as Record<string, unknown>,
      output: call.output as Record<string, unknown> | null,
      startedAt: call.startedAt,
      completedAt: call.completedAt,
      errorMessage: call.errorMessage,
    } as never);
    return call;
  }

  async updateToolCall(callId: string, patch: Partial<AgentToolCall>) {
    const s = schema;
    await this.db
      .update(s.agentToolCalls)
      .set({
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.output ? { output: patch.output as Record<string, unknown> } : {}),
        ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
        ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
      } as never)
      .where(eq(s.agentToolCalls.id, callId) as never);
    const row = await this.db.query.agentToolCalls.findFirst({ where: eq(s.agentToolCalls.id, callId) as never });
    return row ? this.normalizeCall(row as never) : null;
  }

  async createArtifact(artifact: AgentArtifact) {
    const s = schema;
    await this.db.insert(s.agentArtifacts).values({
      id: artifact.id,
      runId: artifact.runId,
      type: artifact.type,
      title: artifact.title,
      content: artifact.content as Record<string, unknown>,
      metadata: artifact.metadata,
      favorite: artifact.favorite,
      createdAt: artifact.createdAt,
    } as never);
    return artifact;
  }

  async updateArtifact(artifactId: string, patch: Partial<AgentArtifact>) {
    const s = schema;
    await this.db
      .update(s.agentArtifacts)
      .set({
        ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}),
        ...(patch.title ? { title: patch.title } : {}),
        ...(patch.content ? { content: patch.content as Record<string, unknown> } : {}),
        ...(patch.metadata ? { metadata: patch.metadata } : {}),
      } as never)
      .where(eq(s.agentArtifacts.id, artifactId) as never);
    const row = await this.db.query.agentArtifacts.findFirst({ where: eq(s.agentArtifacts.id, artifactId) as never });
    return row ? this.normalizeArtifact(row as never) : null;
  }

  async findRelevantHistory(userId: string, query: string, limit = 5) {
    const s = schema;
    const q = `%${query.slice(0, 40)}%`;
    try {
      const rows = await this.db.query.analysisHistory.findMany({
        where: and(
          eq(s.analysisHistory.userId, userId),
          or(
            like(s.analysisHistory.prompt, q),
            like(s.analysisHistory.corePrompt, q)
          )
        ) as never,
        orderBy: desc(s.analysisHistory.createdAt) as never,
        limit,
      });
      return (rows as unknown as Array<{ id: string; prompt: string; corePrompt: string | null; createdAt: Date }>).map((r) => ({
        id: r.id,
        title: r.corePrompt?.slice(0, 60) || "Previous analysis",
        snippet: (r.prompt || "").slice(0, 140),
        createdAt: new Date(r.createdAt).toISOString(),
      }));
    } catch {
      return [];
    }
  }

  // ----- helpers -----

  private mapRunPatch(patch: Partial<AgentRun>): Record<string, unknown> {
    const out: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (patch.status !== undefined) out.status = patch.status;
    if (patch.errorMessage !== undefined) out.errorMessage = patch.errorMessage;
    if (patch.completedAt !== undefined) out.completedAt = patch.completedAt;
    if (patch.taskKind !== undefined) out.taskKind = patch.taskKind;
    if (patch.metadata !== undefined) out.metadata = patch.metadata;
    if (patch.context !== undefined) out.context = patch.context;
    if (patch.attachments !== undefined) out.attachments = patch.attachments;
    if (patch.goal !== undefined) out.goal = patch.goal;
    if (patch.provider !== undefined) out.provider = patch.provider;
    return out;
  }

  private mapStepPatch(patch: Partial<AgentStep>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of ["status", "startedAt", "completedAt", "errorMessage", "outputSummary", "title", "description"] as const) {
      if (patch[key] !== undefined) out[key] = patch[key];
    }
    return out;
  }

  private async assemble(runRow: Record<string, unknown>, _userId: string): Promise<AgentRunDetail> {
    const s = schema;
    const [steps, toolCalls, artifacts] = await Promise.all([
      this.db.query.agentSteps.findMany({ where: eq(s.agentSteps.runId, runRow.id as string) as never, orderBy: asc(s.agentSteps.order) as never }),
      this.db.query.agentToolCalls.findMany({ where: eq(s.agentToolCalls.runId, runRow.id as string) as never, orderBy: asc(s.agentToolCalls.startedAt) as never }),
      this.db.query.agentArtifacts.findMany({ where: eq(s.agentArtifacts.runId, runRow.id as string) as never, orderBy: asc(s.agentArtifacts.createdAt) as never }),
    ]);

    const toArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
    const toIso = (v: unknown): string =>
      v instanceof Date ? v.toISOString() : typeof v === "string" ? v : new Date().toISOString();
    const toIsoOrNull = (v: unknown): string | null =>
      v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null;
    const run = runRow as Record<string, unknown>;
    return {
      id: run.id as string,
      userId: run.userId as string,
      goal: run.goal as string,
      status: run.status as AgentRun["status"],
      provider: (run.provider as string | null) ?? null,
      locale: (run.locale as string) ?? "en",
      taskKind: (run.taskKind as AgentRun["taskKind"]) ?? null,
      createdAt: toIso(run.createdAt),
      updatedAt: toIso(run.updatedAt),
      completedAt: toIsoOrNull(run.completedAt),
      errorMessage: (run.errorMessage as string | null) ?? null,
      metadata: (run.metadata as Record<string, unknown>) ?? {},
      attachments: toArr(run.attachments) as AgentRun["attachments"],
      context: (run.context as Record<string, unknown>) ?? {},
      steps: toArr(steps).map((st) => this.normalizeStep(st as Record<string, unknown>)),
      toolCalls: toArr(toolCalls).map((c) => this.normalizeCall(c as Record<string, unknown>)),
      artifacts: toArr(artifacts).map((a) => this.normalizeArtifact(a as Record<string, unknown>)),
    };
  }

  private normalizeStep(st: Record<string, unknown>): AgentStep {
    const date = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
    return {
      id: st.id as string,
      runId: st.runId as string,
      order: st.order as number,
      title: st.title as string,
      description: st.description as string,
      status: st.status as AgentStep["status"],
      toolName: (st.toolName as string | null) ?? null,
      expectedOutput: (st.expectedOutput as string | null) ?? null,
      startedAt: date(st.startedAt),
      completedAt: date(st.completedAt),
      errorMessage: (st.errorMessage as string | null) ?? null,
      outputSummary: (st.outputSummary as string | null) ?? null,
    };
  }

  private normalizeCall(c: Record<string, unknown>): AgentToolCall {
    const date = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
    return {
      id: c.id as string,
      runId: c.runId as string,
      stepId: c.stepId as string,
      toolName: c.toolName as string,
      status: c.status as AgentToolCall["status"],
      input: (c.input as Record<string, unknown>) ?? {},
      output: (c.output as Record<string, unknown> | null) ?? null,
      startedAt: date(c.startedAt) as string,
      completedAt: date(c.completedAt),
      errorMessage: (c.errorMessage as string | null) ?? null,
    };
  }

  private normalizeArtifact(a: Record<string, unknown>): AgentArtifact {
    return {
      id: a.id as string,
      runId: a.runId as string,
      type: a.type as AgentArtifact["type"],
      title: a.title as string,
      content: (a.content as Record<string, unknown>) ?? {},
      metadata: (a.metadata as Record<string, unknown>) ?? {},
      createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : (a.createdAt as string),
      favorite: Boolean(a.favorite),
    };
  }
}

// ============ 工厂：探测 DATABASE_URL，选择存储实现 ============

let storagePromise: Promise<AgentStorage> | null = null;

async function tryCreateDrizzleStorage(): Promise<AgentStorage | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    // 动态 import，避免无 DATABASE_URL 时加载 db 客户端导致崩溃
    const dbModule = (await import("@/lib/db")) as { db: DrizzleDb };
    const db = dbModule.db;
    // 用一条极轻量查询探测连通性（postgres-js 懒连接，这里会真正发起连接）
    await db.execute(sql`SELECT 1`);
    return new DrizzleAgentStorage(db);
  } catch (error) {
    console.warn("[agent-storage] DATABASE_URL configured but unreachable, falling back to JSON file storage:", (error as Error).message);
    return null;
  }
}

export function getAgentStorage(): Promise<AgentStorage> {
  if (storagePromise) return storagePromise;
  storagePromise = (async () => {
    if (process.env.NODE_ENV === "development") {
      const json = new JsonFileAgentStorage();
      console.log("[agent-storage] Development auth disabled; using JSON file storage at", json["root"]);
      return json;
    }

    const drizzle = await tryCreateDrizzleStorage();
    if (drizzle) {
      console.log("[agent-storage] Using Drizzle (Postgres) storage");
      return drizzle;
    }
    const json = new JsonFileAgentStorage();
    console.log("[agent-storage] Using JSON file storage at", json["root"]);
    return json;
  })();
  return storagePromise;
}

/** 仅供测试重置缓存 */
export function _resetAgentStorageCache() {
  storagePromise = null;
}
