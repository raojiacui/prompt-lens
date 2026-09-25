/**
 * Agent 使用的 LLM 调用封装。
 *
 * 复用项目现有的 AI provider（lib/ai/chat.ts），不另起一套 provider。
 * 当没有可用 API key 或调用失败时，返回 null —— 由 planner 决定是否走 fallback。
 *
 * 注意：动态 import chat 模块，因为 chat 静态依赖 @/lib/db；
 * 无 DATABASE_URL 的 fallback 场景不应因为加载 chat 而崩溃。
 */

export interface AgentChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * 尝试调用现有 AI provider 生成文本。
 * 仅使用 KIE；无可用 Key 或请求失败时返回 null。
 */
export async function tryAgentChat(
  userId: string,
  messages: AgentChatMessage[],
  _preferredProvider?: string | null
): Promise<{ content: string; provider: string } | null> {
  // 显式禁用 AI（测试/演示/无网络环境）时直接走 fallback，避免无效网络/DB 等待
  if (process.env.AGENT_DISABLE_AI === "1" || process.env.AGENT_DISABLE_AI === "true") {
    return null;
  }
  try {
    const { callAIProvider } = await import("@/lib/ai/chat");
    const content = await callAIProvider({ userId, messages });
    if (content.trim()) return { content: content.trim(), provider: "kie" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes("No KIE API key configured")) console.warn("[agent-ai] KIE call failed:", msg);
  }
  return null;
}

/**
 * 从 AI 返回文本中尽力提取 JSON 对象。
 * 兼容模型返回 ```json ... ``` 包裹或前后带解释文字的情况。
 */
export function extractJson(text: string): unknown | null {
  if (!text) return null;
  // 优先尝试整段解析
  try {
    return JSON.parse(text);
  } catch {
    /* continue */
  }
  // 尝试找 ```json ... ``` 或第一个 { ... }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* continue */
    }
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      /* continue */
    }
  }
  return null;
}
