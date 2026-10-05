import { loadEnvFile } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try { loadEnvFile(resolve(root, ".env.local")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
if (!process.env.CRON_SECRET) throw new Error("CRON_SECRET is required for scheduled cleanup");
const endpoint = new URL("/api/cron/media-retention", process.env.MEDIA_RETENTION_BASE_URL || "http://localhost:3000");
if (!["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) && endpoint.protocol !== "https:") {
  throw new Error("Remote cleanup requires HTTPS");
}
const dryRun = process.argv.includes("--dry-run");
if (dryRun) endpoint.searchParams.set("dryRun", "1");
async function tick() {
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    signal: AbortSignal.timeout(280000), redirect: "error",
  });
  if (!response.ok) throw new Error(`Cleanup returned HTTP ${response.status}`);
  const result = await response.json();
  console.log(JSON.stringify({ time: new Date().toISOString(), ...result }));
}
if (process.argv.includes("--once")) {
  await tick();
} else {
  async function loop() {
    try { await tick(); }
    catch (error) { console.error(error.message); }
    setTimeout(loop, 3600000);
  }
  await loop();
}
