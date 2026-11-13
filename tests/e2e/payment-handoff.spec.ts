import { createServer, type Server } from "node:http";
import { test, expect } from "@playwright/test";

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local test address");
  return `http://127.0.0.1:${address.port}`;
}
async function stop(server: Server) {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

test("payment handoff navigates through cashier redirects while a restricted POST form stays blank", async ({ page }) => {
  let received = 0;
  const cashier = createServer((_req, res) => { received++; res.writeHead(200, { "Content-Type": "text/html" }); res.end("<p>Isolated cashier reached</p>"); });
  const cashierOrigin = await listen(cashier);
  let gatewayOrigin = "";
  const gateway = createServer((req, res) => {
    if (req.url === "/gateway") { res.writeHead(302, { Location: `${cashierOrigin}/cashier` }); res.end(); return; }
    if (req.url === "/navigate") { res.writeHead(303, { Location: `${gatewayOrigin}/gateway`, "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'" }); res.end(); return; }
    res.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": `default-src 'none'; script-src 'unsafe-inline'; form-action ${gatewayOrigin}` });
    res.end(`<form action="${gatewayOrigin}/gateway" method="post" name="isolated"><input type="hidden" name="test" value="isolated" /></form><script>document.forms.isolated.submit();</script>`);
  });
  gatewayOrigin = await listen(gateway);
  try {
    const violations: string[] = [];
    page.on("console", msg => { if (msg.text().includes("form-action")) violations.push(msg.text()); });
    await page.goto(`${gatewayOrigin}/form`, { waitUntil: "commit" });
    await expect.poll(() => violations.length).toBeGreaterThan(0);
    expect(received).toBe(0);
    expect(await page.locator("body").innerText()).toBe("");
    await page.goto(`${gatewayOrigin}/navigate`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Isolated cashier reached")).toBeVisible();
    expect(received).toBe(1);
  } finally { await Promise.all([stop(gateway), stop(cashier)]); }
});

for (const locale of ["zh", "en"]) test(`checkout loading timeout keeps the original order ${locale}`, async ({ page, context }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: "localhost", path: "/" }]);
  const orderId = "11111111-1111-4111-8111-111111111111";
  const paymentUrl = `/api/payments/orders/${orderId}/pay`;
  const checkout = { orderId, paymentUrl, amountCents: 2190, credits: 200, rewrites: 20, status: "pending", expiresAt: new Date(Date.now() + 600000).toISOString(), qrImageUrl: null, mobilePaymentUrl: null };
  let created = 0;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/auth/get-session")) return route.fulfill({ json: { user: { id: "test", email: "test@example.com", name: "Test" }, session: { id: "test", expiresAt: new Date(Date.now() + 3600000).toISOString() } } });
    if (path === "/api/payments/checkout") { created++; return route.fulfill({ json: checkout }); }
    if (path === paymentUrl) return;
    if (path === `/api/payments/orders/${orderId}`) return route.fulfill({ json: checkout });
    return route.fulfill({ json: {} });
  });
  await page.goto("/#pricing");
  await page.clock.install();
  await page.getByRole("button", { name: locale === "zh" ? "支付宝购买" : "Buy with Alipay" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("iframe")).toBeVisible();
  await page.clock.fastForward(13000);
  await expect(dialog.getByRole("status").filter({ hasText: locale === "zh" ? "付款页面加载较慢" : "Checkout is taking longer" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: locale === "zh" ? "手机付款 / 二维码无法显示" : "Pay on mobile / QR unavailable" })).toHaveAttribute("href", paymentUrl);
  expect(created).toBe(1);
});
