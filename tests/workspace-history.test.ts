import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { build } from "esbuild";
import { chromium } from "playwright";
import * as schema from "@/lib/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown, userId: "", authenticated: true }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), get db() { return state.db; } }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => state.authenticated ? { user: { id: state.userId } } : null } } }));
import { GET } from "@/app/api/history/route";

const client = new PGlite();
const testDb = drizzle(client, { schema });
// Match postgres-js's row-array execute result while running the SQL in PGlite.
state.db = { execute: async (statement: SQL) => {
  const query = new PgDialect().sqlToQuery(statement);
  return (await client.query(query.sql, query.params)).rows;
} };
let projectId: string;
let oldProjectId: string;
let legacyId: string;
let versionId: string;
const api = (query = "") => GET(new NextRequest(`https://fixture.test/api/history?${query}`));

beforeAll(async () => {
  for (const migration of ["0000_dear_prism", "0003_blushing_thor", "0005_v2_workflow"]) {
    await client.exec(readFileSync(`drizzle/${migration}.sql`, "utf8"));
  }
  state.userId = randomUUID();
  const other = randomUUID();
  await testDb.insert(schema.user).values([{ id: state.userId, email: "history-owner@example.com" }, { id: other, email: "other@example.com" }]);
  const [project, old] = await testDb.insert(schema.projects).values([
    { userId: state.userId, title: "荆轲刺秦王", status: "ready", metadata: { mediaType: "video" }, createdAt: new Date("2026-11-13T05:00:00Z") },
    { userId: state.userId, title: "待完成的图片分析", status: "analyzing", metadata: { mediaType: "image" }, createdAt: new Date("2026-11-11T05:00:00Z") },
    { userId: other, title: "另一账号的私有分析", status: "ready" },
  ]).returning();
  projectId = project.id; oldProjectId = old.id;
  const [legacy] = await testDb.insert(schema.analysisHistory).values({ userId: state.userId, mediaType: "image", mediaName: "旧版图片", prompt: "旧版已保存的提示词", favorite: true, note: "100%_原样", createdAt: new Date("2026-11-12T05:00:00Z") }).returning();
  legacyId = legacy.id;
  await testDb.insert(schema.analysisHistory).values({ userId: other, mediaType: "video", prompt: "另一账号的私有提示词" });
  const [version] = await testDb.insert(schema.projectVersions).values({ projectId, versionNumber: 1, kind: "original", label: "原始分析" }).returning();
  versionId = version.id;
  const [scene] = await testDb.insert(schema.videoScenes).values({ projectId, sceneIndex: 1, startTime: 0, endTime: 5, duration: 5 }).returning();
  await testDb.insert(schema.sceneVersions).values({ projectId, projectVersionId: version.id, originalSceneId: scene.id, sceneIndex: 1, duration: 5, generationPrompt: "黑衣人物穿过宫殿，镜头缓缓推进。" });
  // Include another version: the history detail/search uses the active/latest version.
  const [outdated] = await testDb.insert(schema.projectVersions).values({ projectId, versionNumber: 0, kind: "original", label: "旧草稿" }).returning();
  await testDb.insert(schema.sceneVersions).values({ projectId, projectVersionId: outdated.id, originalSceneId: scene.id, sceneIndex: 1, duration: 5, generationPrompt: "已经替换的旧提示词" });
}, 30_000);
afterAll(async () => client.close());
beforeEach(() => { state.authenticated = true; });

describe("workspace analysis history", () => {
  it("includes existing V2 projects and legacy prompts, preserving owner isolation and chronological pagination", async () => {
    const response = await api("limit=2");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ total: 3, history: [
      { id: `workflow:${projectId}`, source: "workflow", projectId, mediaName: "荆轲刺秦王", sceneCount: 1, status: "ready" },
      { id: legacyId, source: "legacy", favorite: true },
    ] });
    expect(await (await api("limit=2&page=2")).json()).toMatchObject({ total: 3, history: [{ projectId: oldProjectId, mediaType: "image", status: "analyzing" }] });
  });
  it("searches current scene prompts and project titles with matching totals", async () => {
    for (const search of ["宫殿", "荆轲"]) {
      const body = await (await api(`search=${encodeURIComponent(search)}`)).json();
      expect(body).toMatchObject({ total: 1, history: [{ projectId }] });
    }
    expect(await (await api(`search=${encodeURIComponent("已经替换")}`)).json()).toMatchObject({ total: 0, history: [] });
    expect(await (await api(`search=${encodeURIComponent("私有")}`)).json()).toMatchObject({ total: 0, history: [] });
  });
  it("preserves image/favorite filters and treats wildcard input literally", async () => {
    expect(await (await api("favorite=true")).json()).toMatchObject({ total: 1, history: [{ id: legacyId }] });
    expect(await (await api("mediaType=image")).json()).toMatchObject({ total: 2 });
    expect(await (await api("search=%25_")).json()).toMatchObject({ total: 1, history: [{ id: legacyId }] });
  });
  it("rejects unauthenticated reads", async () => {
    state.authenticated = false;
    expect((await api()).status).toBe(401);
  });
  it("reports database failure as an error rather than an empty successful history", async () => {
    const actual = state.db;
    state.db = { execute: () => Promise.reject(new Error("fixture database unavailable")) };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await api();
      expect(response.status).toBe(503);
      expect(await response.json()).not.toHaveProperty("history");
    } finally { state.db = actual; log.mockRestore(); }
  });
});

it("loads saved analysis and generation from the history entry and opens the selected analysis project", async () => {
  const messages = JSON.parse(readFileSync("i18n/messages/zh.json", "utf8"));
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {HistoryList} from './components/history-list';import {VideoWorkflowCreate} from './components/workflow/video-workflow-create';const q=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(q.get('tab')==='analyze'?<VideoWorkflowCreate initialProjectId={q.get('projectId')} onSendToGenerate={()=>{}}/>:<HistoryList/>);`, resolveDir: process.cwd(), loader: "tsx" },
    alias: { "@": process.cwd() }, bundle: true, write: false, platform: "browser", jsx: "automatic",
    plugins: [{ name: "isolated-history-browser", setup(builder) {
      builder.onResolve({ filter: /^next-intl$/ }, () => ({ path: "locale", namespace: "fixture" }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", resolveDir: process.cwd(), contents: args.path === "locale" ? `const messages=${JSON.stringify(messages)};export const useLocale=()=> 'zh';export const useTranslations=(ns)=>(key)=>messages[ns]?.[key]||key;`
        : "import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children);}" }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(7000);
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    let unavailable = false;
    const unexpected: string[] = [];
    const project = { id: projectId, title: "荆轲刺秦王", status: "ready", activeVersionId: versionId, metadata: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const version = { id: versionId, versionNumber: 1, kind: "original", overview: {}, label: "原始分析" };
    const scene = { id: "scene", originalSceneId: "original-scene", sceneIndex: 1, generationPrompt: "黑衣人物穿过宫殿，镜头缓缓推进。", visual: {}, story: {}, audio: {}, transition: {}, dialogue: [], narration: [], subtitle: [], metadata: { recreationPromptVersion: 1 }, duration: 5 };
    const projectBundle = { project, versions: [version], activeVersion: version, sceneVersions: [scene], allSceneVersions: [scene], scenes: [], referenceVideos: [], jobs: [] };
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== "https://fixture.test") return route.fulfill({ status: 404, body: "" });
      if (url.pathname === "/dashboard") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/fixture.js"></script>' });
      if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "application/javascript", body: bundle.outputFiles[0].text });
      if (url.pathname === "/api/auth/get-session") return route.fulfill({ json: { user: { id: state.userId, email: "history-owner@example.com" }, session: { id: "fixture-session", expiresAt: "2099-01-01T00:00:00Z" } } });
      if (url.pathname === "/api/payments/account") return route.fulfill({ json: { wallet: { credits: 0 } } });
      if (url.pathname === "/api/history") {
        if (unavailable) return route.fulfill({ status: 503, json: { error: "unavailable" } });
        return route.fulfill({ json: await (await api(url.searchParams.toString())).json() });
      }
      if (url.pathname === `/api/workflow/projects/${projectId}`) return route.fulfill({ json: projectBundle });
      if (url.pathname === "/api/workflow/projects") return route.fulfill({ json: { projects: [project] } });
      if (url.pathname === "/api/credits/me") return route.fulfill({ json: { mode: "byok", hasUserApiKey: true, commercialConsumptionEnabled: true, commercial: { credits: 0 }, trial: { remaining: 2 }, capabilities: { videoAnalysis: {} } } });
      if (url.pathname === "/api/generation-history") return route.fulfill({ json: { history: [{ id: "own", taskId: "own-task", model: "bytedance/seedance-2-mini", prompt: "已生成视频的保存提示词", payer: "byok", credits: 0, status: "completed", duration: "5", resolution: "720p", videoUrl: "https://media.fixture/result.mp4", createdAt: new Date().toISOString() }], hasMore: false, retentionDays: 7 } });
      unexpected.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto("https://fixture.test/dashboard?tab=history");
    await page.getByRole("button", { name: /荆轲刺秦王/ }).click();
    await page.getByText(scene.generationPrompt, { exact: true }).waitFor();
    expect(await page.getByRole("link", { name: "打开分析项目" }).getAttribute("href")).toContain(`projectId=${projectId}`);
    await page.getByRole("button", { name: "生成历史", exact: true }).click();
    await page.getByRole("button", { name: "查看结果", exact: true }).click();
    expect(await page.locator("video").getAttribute("src")).toBe("https://media.fixture/result.mp4");
    expect(await page.getByText("已生成视频的保存提示词", { exact: true }).count()).toBe(1);
    await page.getByRole("button", { name: "分析历史", exact: true }).click();
    await page.getByRole("button", { name: /荆轲刺秦王/ }).click();
    await page.getByRole("link", { name: "打开分析项目" }).click();
    expect(await page.locator("#recreation-prompt-scene").inputValue()).toBe(scene.generationPrompt);
    expect(page.url()).toContain(`tab=analyze&projectId=${projectId}`);
    // Load failures remain visible and can recover without presenting a false empty state.
    await page.goto("https://fixture.test/dashboard?tab=history");
    unavailable = true;
    await page.getByRole("button", { name: "刷新分析历史" }).click();
    await page.getByRole("alert").filter({ hasText: "分析历史暂时无法加载" }).waitFor();
    unavailable = false;
    await page.getByRole("button", { name: "刷新分析历史" }).click();
    await page.getByRole("button", { name: /荆轲刺秦王/ }).waitFor();
    expect(unexpected).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally { await browser.close(); }
}, 30_000);
