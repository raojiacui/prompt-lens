/**
 * 简单的内存速率限制器
 * 注意：Vercel 无服务器环境下，每个请求可能创建新实例
 * 生产环境建议使用 Upstash Redis: https://upstash.com
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

/**
 * 清理过期条目（生产环境应该用 Redis 自动过期）
 */
function cleanup() {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (entry.resetTime < now) {
      rateLimitMap.delete(key);
    }
  }
}

// 每分钟清理一次
setInterval(cleanup, 60000);

/**
 * 检查速率限制
 * @param identifier 用户 ID 或 IP
 * @param limit 最大请求数
 * @param windowMs 时间窗口（毫秒）
 * @returns { allowed: boolean, remaining: number, resetIn: number }
 */
export function checkRateLimit(
  identifier: string,
  limit: number = 10,
  windowMs: number = 60000
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier);

  if (!entry || entry.resetTime < now) {
    // 新窗口
    rateLimitMap.set(identifier, {
      count: 1,
      resetTime: now + windowMs,
    });
    return {
      allowed: true,
      remaining: limit - 1,
      resetIn: windowMs,
    };
  }

  if (entry.count >= limit) {
    // 超出限制
    return {
      allowed: false,
      remaining: 0,
      resetIn: entry.resetTime - now,
    };
  }

  // 允许请求
  entry.count++;
  return {
    allowed: true,
    remaining: limit - entry.count,
    resetIn: entry.resetTime - now,
  };
}

/**
 * 常用限制配置
 */
export const RateLimitConfigs = {
  // 分析 API - 比较耗资源，限制严格一点
  analyze: { limit: 5, windowMs: 60000 }, // 每分钟 5 次

  // 上传 API
  upload: { limit: 10, windowMs: 60000 }, // 每分钟 10 次

  // 通用 API
  default: { limit: 20, windowMs: 60000 }, // 每分钟 20 次
};