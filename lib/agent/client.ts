"use client";

/**
 * Agent 前端 API 封装。统一处理 { success, data } / { success:false, error } 响应。
 */
import type {
  AgentRunDetail,
  CreateRunInput,
} from "./types";

export interface AgentRunSummary {
  id: string;
  goal: string;
  status: AgentRunDetail["status"];
  taskKind: AgentRunDetail["taskKind"];
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  stepCount: number;
  artifactCount: number;
}

async function parse<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Unexpected response (${res.status})`);
  }
  if (!res.ok || (body && typeof body === "object" && (body as { success?: boolean }).success === false)) {
    const b = body as { error?: string; code?: string; retryAfter?: number };
    const err = new Error(b.error || `Request failed (${res.status})`) as Error & { code?: string; retryAfter?: number };
    err.code = b.code;
    err.retryAfter = b.retryAfter;
    throw err;
  }
  return (body as { data: T }).data;
}

export const agentApi = {
  async createRun(input: CreateRunInput): Promise<{ run: AgentRunDetail }> {
    const res = await fetch("/api/agent/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return parse<{ run: AgentRunDetail }>(res);
  },

  async listRuns(limit = 10): Promise<{ runs: AgentRunSummary[] }> {
    const res = await fetch(`/api/agent/runs?limit=${limit}`, { cache: "no-store" });
    return parse<{ runs: AgentRunSummary[] }>(res);
  },

  async getRun(id: string): Promise<{ run: AgentRunDetail }> {
    const res = await fetch(`/api/agent/runs/${id}`, { cache: "no-store" });
    return parse<{ run: AgentRunDetail }>(res);
  },

  async executeRun(id: string): Promise<{ run: AgentRunDetail }> {
    const res = await fetch(`/api/agent/runs/${id}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume: true }),
    });
    return parse<{ run: AgentRunDetail }>(res);
  },

  async cancelRun(id: string): Promise<{ run: AgentRunDetail }> {
    const res = await fetch(`/api/agent/runs/${id}/cancel`, { method: "POST" });
    return parse<{ run: AgentRunDetail }>(res);
  },

  async retryRun(id: string): Promise<{ run: AgentRunDetail }> {
    const res = await fetch(`/api/agent/runs/${id}/retry`, { method: "POST" });
    return parse<{ run: AgentRunDetail }>(res);
  },

  async deleteRun(id: string): Promise<{ deleted: boolean }> {
    const res = await fetch(`/api/agent/runs/${id}`, { method: "DELETE" });
    return parse<{ deleted: boolean }>(res);
  },

  async setArtifactFavorite(runId: string, artifactId: string, favorite: boolean): Promise<unknown> {
    const res = await fetch(`/api/agent/runs/${runId}/artifacts/${artifactId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite }),
    });
    return parse(res);
  },
};
