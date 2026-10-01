import path from "node:path";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function validateVideoUrl(raw) {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  const allowed = ["douyin.com", "iesdouyin.com", "tiktok.com", "bilibili.com", "b23.tv"];
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !allowed.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error("Provide one public HTTPS Douyin, TikTok, or Bilibili video URL.");
  }
  return url.href;
}

export function selectStreams(candidates) {
  const score = (item) => {
    const resolution = Number(item.description.match(/(\d{3,4})\s*p\b/i)?.[1] || 0);
    const bitrate = Number(item.description.match(/(\d+)\s*kbps/i)?.[1] || 0);
    return resolution * 10000 + bitrate;
  };
  const audioOnly = (item) => /audio\/(mp4|mpeg|webm)|音频\s*\d|audio\s*\d|audio.only/i.test(item.description);
  const videos = candidates.filter((item) => !audioOnly(item) &&
    /video\/|视频|\d{3,4}\s*p\b/i.test(item.description));
  const ranked = [...videos].sort((a, b) => score(b) - score(a));
  const muxed = ranked.find((item) => /with audio|含音频|有声/i.test(item.description) &&
    !/without audio|no audio|无声/i.test(item.description));
  const video = muxed || ranked[0];
  if (!video) throw new Error("No recognizable video download option. The website may have changed.");
  const audio = candidates.filter(audioOnly).sort((a, b) => score(b) - score(a))[0];
  const separate = /仅限视频|video.only|without audio|no audio|无声/i.test(video.description);
  if (separate && !audio) throw new Error("The video has no sound and no separate audio option was found.");
  return separate ? [video, audio] : [video];
}

export async function readCandidates(page) {
  return page.locator("a, button").evaluateAll((nodes) => {
    const found = [];
    for (const node of nodes) {
      if (!/^(download|下载)$/i.test(node.textContent?.trim() || "")) continue;
      if (node.getAttribute("disabled") !== null || node.getAttribute("aria-disabled") === "true") continue;
      if (!node.getClientRects().length) continue;
      let parent = node.parentElement;
      let description = "";
      for (let level = 0; parent && level < 4; level++, parent = parent.parentElement) {
        if (parent.querySelector("input")) break;
        const text = parent.innerText || "";
        const buttons = [...parent.querySelectorAll("a, button")]
          .filter((element) => /^(download|下载)$/i.test(element.textContent?.trim() || ""));
        if (buttons.length > 1) break;
        if (/video\/|audio\/|视频|音频|\d{3,4}\s*p\b/i.test(text)) description = text.slice(0, 800);
      }
      if (!description) continue;
      const id = `pl-local-stream-${found.length}`;
      node.setAttribute("data-pl-local-stream", id);
      found.push({ id, description });
    }
    return found;
  });
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log('Usage: node scripts/easydown-web-download.mjs "PUBLIC_VIDEO_URL"');
    console.log("Single local run; saves browser downloads under .data/easydown-web/. No paid API or automatic retries.");
    return;
  }
  if (process.argv.length !== 3) throw new Error("Exactly one video URL is required. Use --help for usage.");
  const url = validateVideoUrl(process.argv[2]);
  const { chromium } = await import("playwright");
  const directory = path.resolve(".data/easydown-web", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(directory, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  let blocked = false;
  let submitted = false;
  page.on("response", (response) => {
    if (submitted && [403, 429].includes(response.status()) &&
        /(^|\.)easydown\.org$/.test(new URL(response.url()).hostname)) blocked = true;
  });
  try {
    await page.goto("https://easydown.org/", { waitUntil: "domcontentloaded", timeout: 45000 });
    const input = page.getByPlaceholder(/paste.*(video|link)|粘贴.*链接/i).first();
    await input.fill(url, { timeout: 15000 });
    const submit = page.getByRole("button", { name: /^(download|下载)$/i }).first();
    const readyDeadline = Date.now() + 30000;
    while (Date.now() < readyDeadline && !await submit.isEnabled()) {
      await page.waitForTimeout(1000);
    }
    if (!await submit.isEnabled()) {
      throw new Error("The website kept Download disabled. Verification or page validation may be incomplete; nothing was submitted.");
    }
    submitted = true;
    await submit.click({ timeout: 15000 });
    console.log("Submitted once. Waiting for download options...");
    const deadline = Date.now() + 90000;
    let candidates = [];
    while (Date.now() < deadline) {
      if (blocked) throw new Error("The website refused or rate-limited the request. Stopped without retrying.");
      const text = await page.locator("body").innerText({ timeout: 5000 });
      if (/verify you are human|确认您是真人|验证您是真人|access denied|too many requests/i.test(text)) {
        throw new Error("Human verification or access restriction detected. No bypass is attempted.");
      }
      candidates = await readCandidates(page);
      if (candidates.length) break;
      await page.waitForTimeout(1000);
    }
    if (!candidates.length) throw new Error("No download options within 90 seconds; verification, parsing failure, or a changed page may be responsible.");
    const selected = selectStreams(candidates);
    for (const [index, stream] of selected.entries()) {
      console.log(`Downloading stream ${index + 1}/${selected.length}: ${stream.description.replace(/\s+/g, " ")}`);
      const pending = page.waitForEvent("download", { timeout: 45000 });
      const download = await Promise.all([
        pending,
        page.locator(`[data-pl-local-stream="${stream.id}"]`).click({ timeout: 10000 }),
      ]).then(([value]) => value);
      const failure = await download.failure();
      if (failure) throw new Error(`Browser download failed: ${failure}`);
      const filename = path.basename(download.suggestedFilename()).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "media.bin";
      const destination = path.join(directory, `${index + 1}-${filename}`);
      await download.saveAs(destination);
      console.log(`Saved: ${destination}`);
    }
    console.log(selected.length === 2
      ? "Saved separate video and audio files. They still need merging before upload."
      : "Download complete. Playback and sound still need verification.");
  } catch (error) {
    const screenshot = path.join(directory, "failure.png");
    await page.screenshot({ path: screenshot, fullPage: true }).then(() => {
      console.error(`Diagnostic screenshot: ${screenshot}`);
    }).catch(() => {});
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
