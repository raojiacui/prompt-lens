/**
 * 迁移脚本：加密现有 API Key
 *
 * 运行方式: pnpm tsx scripts/migrate-encrypt-api-keys.ts
 *
 * 注意：这个脚本需要 BETTER_AUTH_SECRET 环境变量
 */

import { db } from "@/lib/db";
import { userApiKeys } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { encryptApiKey, isValidEncryptedKey } from "@/lib/utils/encryption";

async function migrate() {
  console.log("Starting API Key encryption migration...");

  // 获取所有用户 API Key
  const allKeys = await db.query.userApiKeys.findMany();

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
      await db
        .update(userApiKeys)
        .set({
          apiKey: encryptedKey,
          updatedAt: new Date(),
        })
        .where(eq(userApiKeys.id, key.id));

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
}

migrate().catch(console.error);
