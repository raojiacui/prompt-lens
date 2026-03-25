/**
 * 迁移脚本：加密现有 API Key
 * 使用 Drizzle Kit 直接执行
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { encryptApiKey, isValidEncryptedKey } from "@/lib/utils/encryption";
import { readFileSync } from "fs";
import { resolve } from "path";

// 加载 .env 文件
function loadEnv() {
  const envPath = resolve(process.cwd(), ".env");
  try {
    const envContent = readFileSync(envPath, "utf8");
    const lines = envContent.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex);
          const value = trimmed.substring(eqIndex + 1);
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    }
    console.log("Loaded .env file");
  } catch (e) {
    console.log("Using system environment variables");
  }
}

loadEnv();

// 打印数据库 URL（隐藏密码）
const dbUrl = process.env.DATABASE_URL || "";
const maskedDbUrl = dbUrl.replace(/:([^@]+)@/, ":***@");
console.log("DATABASE_URL:", maskedDbUrl);

async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not found!");
    process.exit(1);
  }

  // 直接创建 postgres 客户端
  const client = postgres(process.env.DATABASE_URL);
  const db = drizzle(client, { schema });

  console.log("Starting API Key encryption migration...");

  // 获取所有用户 API Key
  const allKeys = await db.select().from(schema.userApiKeys);

  console.log(`Found ${allKeys.length} API keys to check`);

  let encryptedCount = 0;
  let alreadyEncryptedCount = 0;
  let errorCount = 0;

  for (const key of allKeys) {
    try {
      // 检查是否已经是加密的
      if (isValidEncryptedKey(key.apiKey)) {
        console.log(`  [${key.id}] Already encrypted, skipping`);
        alreadyEncryptedCount++;
        continue;
      }

      // 加密现有的明文 API Key
      const encryptedKey = encryptApiKey(key.apiKey);

      // 更新数据库
      await db.update(schema.userApiKeys)
        .set({
          apiKey: encryptedKey,
          updatedAt: new Date(),
        })
        .where(schema.eq(schema.userApiKeys.id, key.id));

      console.log(`  [${key.id}] Encrypted successfully (provider: ${key.provider})`);
      encryptedCount++;
    } catch (error) {
      console.error(`  [${key.id}] Error:`, error);
      errorCount++;
    }
  }

  console.log("\nMigration complete!");
  console.log(`  - Already encrypted: ${alreadyEncryptedCount}`);
  console.log(`  - Newly encrypted: ${encryptedCount}`);
  console.log(`  - Errors: ${errorCount}`);

  await client.end();
}

migrate().catch(console.error);
