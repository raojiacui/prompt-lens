/**
 * Vitest 全局 setup：
 * 设置最小可用的环境变量，避免在测试 fallback 路径时，
 * 动态 import 到 @/lib/db（postgres-js）因缺少连接串而抛错。
 * 不会发起真实连接（postgres-js 懒连接，且 Agent 测试只用 InMemory storage）。
 */
process.env.DATABASE_URL ??= "postgres://localhost:5432/postgres";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret";
// 测试中强制走 deterministic fallback planner/mock tools，不发起真实 AI/网络调用
process.env.AGENT_DISABLE_AI = "1";
try {
  Object.defineProperty(process.env, "NODE_ENV", { value: "test", configurable: true });
} catch {
  /* some environments make NODE_ENV read-only; ignore */
}
