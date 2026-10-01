import { describe, expect, it, vi } from "vitest";

const next = vi.hoisted(() => vi.fn(async () => Response.json({ ok: true })));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("better-auth/next-js", () => ({ toNextJsHandler: () => ({ GET: next, POST: next, PATCH: next, PUT: next, DELETE: next }) }));
import { GET, POST, PATCH, PUT, DELETE } from "@/app/api/auth/[...all]/route";

describe("role-based admin plugin endpoints", () => {
  it("blocks every method before the plugin can grant roles or impersonate users", async () => {
    for (const [method, handler] of [["GET", GET], ["POST", POST], ["PATCH", PATCH], ["PUT", PUT], ["DELETE", DELETE]] as const) {
      const response = await handler(new Request("http://localhost/api/auth/admin/set-role", { method }));
      expect(response.status).toBe(403);
    }
    expect(next).not.toHaveBeenCalled();
  });
  it("blocks encoded admin paths as well", async () => {
    expect((await POST(new Request("http://localhost/api/auth/%61dmin%2fset-role", { method: "POST" }))).status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
  it("preserves normal login and session endpoints", async () => {
    expect((await GET(new Request("http://localhost/api/auth/get-session"))).status).toBe(200);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
