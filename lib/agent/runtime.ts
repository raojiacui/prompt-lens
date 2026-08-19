/**
 * Agent 运行时状态：
 * - 跟踪每个 run 的取消信号（cancel API 设置，executor 检查）
 * - 跟踪正在执行的 run，避免同一 run 被重复启动
 * - 提供 fire-and-forget 后台执行入口
 *
 * 注意：这是进程内状态。在 Vercel 等 serverless 平台上，后台 Promise 可能在
 * 响应返回后被冻结；本地开发/自托管环境下完全可用。executor 本身是无状态的，
 * 也可以通过 POST /execute?wait=true 同步执行（测试和可靠场景使用）。
 */

import { executeRun } from "./executor";
import type { AgentStorage } from "./storage";

const cancelFlags = new Map<string, boolean>();
const runningRuns = new Set<string>();

export function isRunRunning(runId: string): boolean {
  return runningRuns.has(runId);
}

export function requestCancel(runId: string): void {
  cancelFlags.set(runId, true);
}

export function isCancelled(runId: string): boolean {
  return cancelFlags.get(runId) === true;
}

export function clearCancel(runId: string): void {
  cancelFlags.delete(runId);
}

/**
 * 在后台执行一个 run（不 await）。返回后 executor 继续运行并把状态写入 storage。
 * 如果 run 已在运行，直接返回 false。
 */
export function startRunInBackground(
  runId: string,
  userId: string,
  storage: AgentStorage,
  opts?: { resume?: boolean }
): boolean {
  if (runningRuns.has(runId)) return false;
  runningRuns.add(runId);
  clearCancel(runId);

  // fire-and-forget
  void (async () => {
    try {
      await executeRun(runId, storage, {
        userId,
        resume: opts?.resume ?? false,
        isCancelled: () => isCancelled(runId),
      });
    } catch (error) {
      console.error(`[agent-runtime] run ${runId} failed:`, error);
    } finally {
      runningRuns.delete(runId);
    }
  })();

  return true;
}
