/** Agent 系统统一错误类型 */

export type AgentErrorCode =
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "STORAGE_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE"
  | "EXECUTION_FAILED"
  | "CANCELLED"
  | "INTERNAL";

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: AgentErrorCode, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isAgentError(error: unknown): error is AgentError {
  return error instanceof AgentError;
}

/** 将任意错误转换为 HTTP 状态码与消息 */
export function toHttpError(error: unknown): { status: number; body: { success: false; error: string; code: string } } {
  if (isAgentError(error)) {
    return {
      status: error.status,
      body: { success: false, error: error.message, code: error.code },
    };
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  return {
    status: 500,
    body: { success: false, error: message, code: "INTERNAL" },
  };
}
