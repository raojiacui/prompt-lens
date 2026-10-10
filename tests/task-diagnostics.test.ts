import { afterEach, expect, it, vi } from "vitest";
import { taskErrorDetails } from "@/lib/billing/task-diagnostics";
afterEach(() => vi.unstubAllEnvs());
it("records database causes and stack without SQL values, keys or signed URLs", () => {
  vi.stubEnv("KIE_AI_API_KEY", "private-test-secret");
  const cause = Object.assign(new Error("connection lost private-test-secret https://storage.test/file?signature=secret"), { code: "08006" });
  const error = new Error("Failed query: insert values ('private-user-data')", { cause });
  const details = taskErrorDetails(error);
  expect(details).toMatchObject({ message: "Database query failed; see cause", cause: { code: "08006", message: "connection lost [REDACTED] [URL]" } });
  expect(JSON.stringify(details)).not.toMatch(/private-test-secret|private-user-data|signature=secret/);
  expect(details.stack).toContain("task-diagnostics.test.ts");
});
it("bounds circular causes", () => {
  const error = new Error("loop"); error.cause = error;
  expect(JSON.stringify(taskErrorDetails(error)).length).toBeLessThan(16000);
});
