import { defineRouting } from "next-intl/routing";

/**
 * next-intl 路由配置 - cookie 模式
 * localePrefix: 'as-needed' 表示默认 locale (zh) 不加前缀，
 * 非默认 locale (en) 也不加前缀（因为我们用 cookie 切换，不用 URL 前缀）。
 *
 * 注意：next-intl 在 'never' 模式下会要求 [locale] 动态段 + setRequestLocale，
 * 这里用 'as-needed' + 不使用 createMiddleware 路由（改用手动 cookie）来规避。
 */
export const routing = defineRouting({
  locales: ["zh", "en"],
  defaultLocale: "zh",
});
