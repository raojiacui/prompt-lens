/**
 * 自动配置 B2 Bucket 的 CORS 规则
 *
 * 用法：
 *   1. 确保 .env.local 里配好 B2_ACCESS_KEY_ID / B2_SECRET_ACCESS_KEY / B2_BUCKET_NAME
 *   2. 修改下面的 ALLOWED_ORIGINS 为你的线上域名
 *   3. node scripts/setup-b2-cors.mjs
 *
 * B2 CORS 必须用原生 API（b2_update_bucket），S3 API 不支持。
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============ 改这里 ============
const ALLOWED_ORIGINS = [
  "https://prompt-lens.cc.cd",
  "http://localhost:3000",
];
// =================================

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) {
    throw new Error(`找不到 ${envPath}，请先创建并配置 B2_* 环境变量`);
  }
  const content = fs.readFileSync(envPath, "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // 去引号
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function b2Authorize(keyId, secret) {
  const credentials = Buffer.from(`${keyId}:${secret}`).toString("base64");
  const res = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", {
    method: "GET",
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`b2_authorize_account 失败 (${res.status}): ${text}`);
  }
  const data = await res.json();
  const storageApi = data.apiInfo?.storageApi;
  if (!storageApi) {
    throw new Error("响应中没有 apiInfo.storageApi，key 可能不支持");
  }
  return {
    accountId: data.accountId,
    apiUrl: storageApi.apiUrl,
    authorizationToken: data.authorizationToken,
    allowedBucketId: storageApi.bucketId,
    allowedBucketName: storageApi.bucketName,
  };
}

async function listBuckets(apiUrl, token) {
  const res = await fetch(`${apiUrl}/b2api/v3/b2_list_buckets`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ bucketType: "all" }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`b2_list_buckets 失败 (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.buckets;
}

async function updateBucketCors(apiUrl, token, bucketId, bucketName, corsRules, accountId) {
  const res = await fetch(`${apiUrl}/b2api/v3/b2_update_bucket`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId,
      bucketId,
      corsRules,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`b2_update_bucket 失败 (${res.status}): ${text}`);
  }
  return res.json();
}

async function main() {
  console.log("=== B2 CORS 自动配置脚本 ===\n");

  const env = loadEnv();
  const keyId = env.B2_ACCESS_KEY_ID;
  const secret = env.B2_SECRET_ACCESS_KEY;
  const bucketName = env.B2_BUCKET_NAME;

  if (!keyId || !secret || !bucketName) {
    throw new Error(
      ".env.local 缺少 B2_ACCESS_KEY_ID / B2_SECRET_ACCESS_KEY / B2_BUCKET_NAME"
    );
  }

  console.log(`Bucket: ${bucketName}`);
  console.log(`Key ID: ${keyId.slice(0, 6)}...`);
  console.log(`Allowed Origins:`);
  for (const o of ALLOWED_ORIGINS) console.log(`  - ${o}`);
  console.log();

  console.log("[1/2] 授权中...");
  const auth = await b2Authorize(keyId, secret);
  console.log(`  ✓ apiUrl: ${auth.apiUrl}`);
  console.log(`  ✓ bucketId: ${auth.allowedBucketId} (${auth.allowedBucketName})`);

  if (auth.allowedBucketName && auth.allowedBucketName !== bucketName) {
    throw new Error(
      `Key 限定的 bucket "${auth.allowedBucketName}" 与配置的 "${bucketName}" 不一致`
    );
  }

  const corsRules = [
    {
      corsRuleName: "prompt-lens-upload",
      allowedHeaders: ["*"],
      allowedOperations: ["s3_put", "s3_get"],
      allowedOrigins: ALLOWED_ORIGINS,
      exposeHeaders: ["ETag", "x-bz-content-sha1"],
      maxAgeSeconds: 3600,
    },
  ];

  console.log("[2/2] 更新 CORS...");
  const result = await updateBucketCors(
    auth.apiUrl,
    auth.authorizationToken,
    auth.allowedBucketId,
    bucketName,
    corsRules,
    auth.accountId
  );
  console.log("  ✓ 更新成功");
  console.log("\n新 CORS 规则：");
  console.log(JSON.stringify(result.corsRules, null, 2));
  console.log("\n✅ 完成！现在前端可以直传 B2 了。");
}

main().catch((err) => {
  console.error("\n❌ 失败:", err.message);
  process.exit(1);
});
