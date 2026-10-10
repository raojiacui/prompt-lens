export function safeDiagnosticText(value: string) {
  let text = value;
  for (const [name, secret] of Object.entries(process.env)) {
    if (/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/.test(name) && secret && secret.length >= 8) text = text.split(secret).join("[REDACTED]");
  }
  return text.replace(/https?:\/\/[^\s"'<>]+|postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[URL]")
    .replace(/Bearer\s+[^\s"']+|\b(?:sk-|ed_live_)[\w-]+/gi, "[REDACTED]");
}

export function taskErrorDetails(error: unknown, depth = 0): Record<string, unknown> {
  if (depth > 3) return { message: "Cause chain truncated" };
  const value = error instanceof Error ? error as Error & { code?: unknown; cause?: unknown } : null;
  const message = value?.message || (typeof error === "string" ? error : "Unknown task error");
  // Database wrappers may embed SQL and bound user data in their message.
  const clean = /^Failed query:/i.test(message) ? "Database query failed; see cause" : message;
  return { name: value?.name || "Error", message: safeDiagnosticText(clean).slice(0, 1000),
    ...(typeof value?.code === "string" ? { code: safeDiagnosticText(value.code).slice(0, 80) } : {}),
    ...(value?.stack ? { stack: safeDiagnosticText(value.stack.replace(message, clean)).slice(0, 3000) } : {}),
    ...(value?.cause !== undefined ? { cause: taskErrorDetails(value.cause, depth + 1) } : {}) };
}
