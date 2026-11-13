import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const state = vi.hoisted(() => ({ admin: true, rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/auth", () => ({ isAdmin: async () => state.admin, auth: { api: { getSession: async () => ({ user: { id: "fixture-user" } }) } } }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), db: { query: {
  userApiKeys: { findMany: async () => state.rows }, creditLedger: { findMany: async () => [] },
} } }));
vi.mock("@/lib/billing/credits", () => ({ getCreditBalance: async () => ({ balance: 20 }), assertHasCredits: vi.fn(), creditErrorResponse: vi.fn(), deductCreditsFromUser: vi.fn() }));
vi.mock("@/lib/usage/trial-quota", () => ({ getUserTrialUsage: async () => ({ used: 0, limit: 2, remaining: 2, isAdmin: state.admin }), assertTrialQuota: vi.fn(), trialQuotaResponse: vi.fn() }));
vi.mock("@/lib/billing/commercial-rewrite", () => ({ getCommercialRewriteBalance: async () => ({ credits: 20, rewrites: 2 }) }));
vi.mock("@/lib/billing/commercial-wallet", () => ({ getIncludedLinkImportUsage: async () => ({ total: 0, used: 0, remaining: 0 }) }));

import { encryptApiKey } from "@/lib/utils/encryption";
import { getUserCredential } from "@/lib/byok/credentials";
import { GET as settings } from "@/app/api/settings/api-key/route";
import { GET as credits } from "@/app/api/credits/me/route";

beforeEach(() => {
  state.admin = true; state.rows = [];
  vi.stubEnv("BYOK_ENCRYPTION_KEY", "isolated-byok-integration-secret");
  vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", "true");
  vi.stubEnv("KIE_AI_API_KEY", "fixture-platform-key");
});
afterEach(() => { vi.unstubAllEnvs(); });

function saveFixture(provider: "kie" | "infistar") {
  const apiKey = `fixture-${provider}-saved-key`;
  state.rows = [{ id: "saved-key", userId: "fixture-user", provider, apiKey: encryptApiKey(apiKey), isActive: true,
    // Reproduce the existing owner record: a single active, non-preferred key.
    isPreferred: false, createdAt: new Date(), updatedAt: new Date() }];
  return apiKey;
}

it.each([true, false])("reports the saved provider consistently from Settings to credit status (admin=%s)", async admin => {
  state.admin = admin;
  const apiKey = saveFixture("infistar");
  const saved = await (await settings(new NextRequest("https://fixture.test/api/settings/api-key"))).json();
  expect(saved).toMatchObject({ preferredProvider: "infistar", apiKeys: [{ provider: "infistar", isActive: true, decryptError: false }] });
  const response = await credits(new NextRequest("https://fixture.test/api/credits/me"));
  expect(response.status).toBe(200);
  const status = await response.json();
  expect(status).toMatchObject({ mode: admin ? "admin" : "byok", hasUserApiKey: true, byokProvider: "infistar", commercial: { credits: 20 } });
  expect(await getUserCredential("fixture-user")).toEqual({ provider: "infistar", apiKey });
  expect(JSON.stringify([saved, status])).not.toContain(apiKey);
});

it("also reports an administrator's saved KIE key without changing administrator mode", async () => {
  saveFixture("kie");
  expect(await (await credits(new NextRequest("https://fixture.test/api/credits/me"))).json())
    .toMatchObject({ mode: "admin", hasUserApiKey: true, byokProvider: "kie" });
});

it("does not count the administrator's platform access as a saved personal key", async () => {
  expect(await (await credits(new NextRequest("https://fixture.test/api/credits/me"))).json())
    .toMatchObject({ mode: "admin", hasUserApiKey: false, canUsePlatformKie: true });
});

async function buildAnalysisPage() {
  return build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {VideoWorkflowCreate} from './components/workflow/video-workflow-create';createRoot(document.getElementById('root')).render(<VideoWorkflowCreate onSendToGenerate={()=>{}}/>);`, resolveDir: process.cwd(), loader: "tsx" },
    alias: { "@": process.cwd() }, bundle: true, write: false, platform: "browser", jsx: "automatic",
    plugins: [{ name: "isolated-analysis-browser", setup(builder) {
      builder.onResolve({ filter: /^next-intl$/ }, () => ({ path: "locale", namespace: "fixture" }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
      builder.onResolve({ filter: /lib\/r2-upload-client$/ }, () => ({ path: "upload", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", resolveDir: process.cwd(), contents: args.path === "locale" ? "export const useLocale=()=> 'zh';"
        : args.path === "link" ? "import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children);}" : "export const uploadMediaToR2=async(file)=>({url:'https://media.fixture/reference.mp4',filename:file.name,mediaType:'video',size:file.size,key:'fixture-video'});" }));
    } }],
  });
}

it("lets the real analysis page use the saved Infistar status and submit a BYOK quote", async () => {
  saveFixture("infistar");
  const status = await (await credits(new NextRequest("https://fixture.test/api/credits/me"))).json();
  const bundle = await buildAnalysisPage();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    page.on("pageerror", error => console.error("analysis-browser-error", error.message));
    const quotes: Record<string, unknown>[] = [];
    let confirmations = 0;
    await page.route("**/*", async route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.origin !== "https://fixture.test") return route.fulfill({ status: 404, body: "" });
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      if (url.pathname === "/api/credits/me") return route.fulfill({ json: status });
      if (url.pathname === "/api/workflow/projects") return route.fulfill({ json: request.method() === "POST" ? { project: { id: "fixture-project" } } : { projects: [] } });
      if (url.pathname === "/api/commercial/analysis") {
        const body = request.postDataJSON();
        if (body.action === "prepare") return route.fulfill({ json: { id: "fixture-preparation", durationUs: 1_000_000, scenes: [{ id: "1", startUs: 0, endUs: 1_000_000 }] } });
        quotes.push(body);
        return route.fulfill({ json: { id: "fixture-quote", credits: 1, splitCredits: 1, analysisCredits: 0, expiresAt: new Date(Date.now() + 600_000).toISOString() } });
      }
      if (url.pathname.startsWith("/api/commercial/tasks")) confirmations++;
      return route.fulfill({ status: 400, json: { code: "UNEXPECTED_TEST_REQUEST" } });
    });
    await page.goto("https://fixture.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const video = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=12:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"]);
    await page.locator('input[type="file"]').setInputFiles({ name: "fixture.mp4", mimeType: "video/mp4", buffer: video });
    await page.getByLabel("费用来源", { exact: true }).selectOption("byok");
    await page.getByRole("button", { name: "分析视频", exact: true }).click();
    await vi.waitFor(() => expect(quotes.length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(quotes.at(-1)).toMatchObject({ payer: "byok_split", preparationId: "fixture-preparation" });
    expect(await page.locator("body").innerText()).not.toContain("请先在设置中配置自己的 API Key");
    expect(status.byokProvider).toBe("infistar");
    expect(confirmations).toBe(0);
  } finally { await browser.close(); }
}, 30_000);

it.each(["byok", "trial"])("keeps whole-video progress accurate and submits the correct model for %s", async mode => {
  if (mode === "byok") saveFixture("infistar");
  else state.admin = false;
  const status = await (await credits(new NextRequest("https://fixture.test/api/credits/me"))).json();
  if (mode === "trial") status.commercial.credits = 0;
  const bundle = await buildAnalysisPage();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    page.on("pageerror", error => console.error("analysis-browser-error", error.message));
    let polls = 0; let failed = false; let submissions = 0; let submittedModel = "";
    const startedAt = Date.now() - 10_000;
    await page.clock.install();
    await page.route("**/*", route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.origin !== "https://fixture.test") return route.fulfill({ status: 404, body: "" });
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      if (url.pathname === "/api/credits/me") return route.fulfill({ json: status });
      if (url.pathname === "/api/workflow/projects") return route.fulfill({ json: request.method() === "POST" ? { project: { id: "fixture-project" } } : { projects: [] } });
      if (url.pathname.endsWith("/breakdown")) { submissions++; submittedModel = request.postDataJSON().modelId; return route.fulfill({ json: { taskId: "fixture-task" } }); }
      if (url.pathname === "/api/commercial/tasks/fixture-task") {
        polls++;
        return route.fulfill({ json: { state: failed ? "failed" : "running", totalScenes: 1, completedScenes: 0, phase: "analyzing", automaticSplit: false, mediaType: "video", startedAt, error: failed ? "该镜头分析中断" : undefined } });
      }
      return route.fulfill({ status: 400, json: { code: "UNEXPECTED_TEST_REQUEST" } });
    });
    await page.goto("https://fixture.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const video = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=12:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"]);
    await page.locator('input[type="file"]').setInputFiles({ name: "fixture.mp4", mimeType: "video/mp4", buffer: video });
    await page.getByRole("radio", { name: "整段分析", exact: true }).check();
    if (mode === "byok") await page.getByLabel("费用来源", { exact: true }).selectOption("byok");
    const expectedModel = mode === "trial" ? "analysis-deepseek-v4-1-flash" : "analysis-gemini-3-8-flash";
    expect(await page.getByLabel("分析模型").inputValue()).toBe(expectedModel);
    await page.getByRole("button", { name: "分析视频", exact: true }).click();
    await page.getByText("已处理 0/1 个镜头", { exact: true }).waitFor();
    expect(submittedModel).toBe(expectedModel);
    const progress = page.getByTestId("workflow-analysis-progress");
    expect(await progress.innerText()).toContain("整段分析");
    expect(await progress.innerText()).not.toContain("拆镜分析");
    expect(await page.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("65");
    await page.clock.runFor(3500);
    expect(await page.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("65");
    await page.clock.runFor(5000);
    expect(await page.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("65");
    failed = true;
    await page.clock.runFor(4500);
    await page.getByText("该镜头分析中断", { exact: true }).waitFor();
    const stopped = polls;
    await page.clock.runFor(5000);
    expect(polls).toBe(stopped);
    expect(submissions).toBe(1);
  } finally { await browser.close(); }
}, 30_000);
