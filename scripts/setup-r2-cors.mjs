/**
 * Configure Cloudflare R2 CORS for browser uploads.
 *
 * Usage:
 *   1. Configure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *      and R2_BUCKET_NAME in .env.local.
 *   2. Adjust ALLOWED_ORIGINS below.
 *   3. Run: node scripts/setup-r2-cors.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

const ALLOWED_ORIGINS = [
  "https://prompt-lens.cc.cd",
  "http://localhost:3000",
];

function loadEnv() {
  const envPath = path.join(scriptDirectory, "..", ".env.local");
  if (!fs.existsSync(envPath)) {
    throw new Error(`Cannot find ${envPath}. Configure the R2 environment variables first.`);
  }

  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
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

async function main() {
  const env = loadEnv();
  const endpoint = env.R2_ENDPOINT || (env.R2_ACCOUNT_ID
    ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : "");
  const required = ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
  const missing = required.filter((name) => !env[name]);
  if (!endpoint) missing.unshift("R2_ENDPOINT or R2_ACCOUNT_ID");
  if (missing.length > 0) throw new Error(`Missing environment variables: ${missing.join(", ")}`);

  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });

  await client.send(new PutBucketCorsCommand({
    Bucket: env.R2_BUCKET_NAME,
    CORSConfiguration: {
      CORSRules: [{
        AllowedHeaders: ["*"],
        AllowedMethods: ["GET", "PUT", "HEAD"],
        AllowedOrigins: ALLOWED_ORIGINS,
        ExposeHeaders: ["ETag"],
        MaxAgeSeconds: 3600,
      }],
    },
  }));

  console.log(`R2 CORS configured for ${env.R2_BUCKET_NAME}`);
  for (const origin of ALLOWED_ORIGINS) console.log(`  - ${origin}`);
}

main().catch((error) => {
  console.error("Failed to configure R2 CORS:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
