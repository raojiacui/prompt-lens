import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MAX_GROUPS = 20;
const MAX_FAILURE_LENGTH = 2_000;

export function parseJsonLines(value) {
  const lines = value.split(/\r?\n/u).filter((line) => line.trim() !== "");

  const records = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Invalid Vercel JSONL at line ${index + 1}: ${error.message}`,
      );
    }
  });

  return records.flatMap((record) => {
    if (record?.type === "summary") return [];
    if (
      (record?.type === "log" || record?.type === "request")
      && record.data
      && typeof record.data === "object"
      && !Array.isArray(record.data)
    ) {
      return [record.data];
    }
    return [record];
  });
}

function statusCodeOf(entry) {
  const value = entry.httpStatus ?? entry.statusCode ?? entry.status;
  const statusCode = Number(value);
  return Number.isFinite(statusCode) ? statusCode : null;
}

function deploymentIdOf(entry) {
  const value = entry.deploymentId ?? entry.deployment?.id;
  return value === undefined || value === null || value === ""
    ? null
    : String(value);
}

function timestampOf(entry) {
  const raw = entry.timestamp ?? entry.createdAt ?? entry.time;
  if (raw === undefined || raw === null || raw === "") return null;

  const date = typeof raw === "number" ? new Date(raw) : new Date(String(raw));
  return Number.isNaN(date.getTime()) ? null : date;
}

function messageOf(entry) {
  return String(entry.message ?? entry.text ?? entry.proxy?.message ?? "(无日志消息)");
}

function pathOf(entry) {
  return String(
    entry.path ?? entry.requestPath ?? entry.route ?? entry.proxy?.path ?? "(未知路径)",
  );
}

function uniqueKey(entry) {
  if (entry.id) return `id:${entry.id}`;

  return [
    entry.requestId ?? "",
    entry.timestamp ?? entry.createdAt ?? entry.time ?? "",
    entry.level ?? "",
    statusCodeOf(entry) ?? "",
    pathOf(entry),
    messageOf(entry),
  ].join("|");
}

function isActionable(entry) {
  const level = String(entry.level ?? "").toLowerCase();
  const statusCode = statusCodeOf(entry);
  return level === "error" || level === "fatal" || (statusCode !== null && statusCode >= 500);
}

export function mergeActionableLogs(...collections) {
  const seen = new Set();
  const result = [];

  for (const entry of collections.flat()) {
    if (!entry || typeof entry !== "object" || !isActionable(entry)) continue;

    const key = uniqueKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }

  return result.sort((left, right) => {
    const leftTime = timestampOf(left)?.getTime() ?? 0;
    const rightTime = timestampOf(right)?.getTime() ?? 0;
    return rightTime - leftTime;
  });
}

function normalizedMessage(value) {
  return value
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/giu, "<id>")
    .replace(/\b[0-9a-f]{6,}\b/giu, "<id>")
    .replace(/\b\d{6,}\b/gu, "<number>")
    .replace(/\s+/gu, " ")
    .trim();
}

function formatShanghaiTime(date) {
  if (!date) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function groupLogs(logs) {
  const groups = new Map();

  for (const log of logs) {
    const statusCode = statusCodeOf(log);
    const deploymentId = deploymentIdOf(log);
    const pathName = pathOf(log);
    const message = messageOf(log);
    const fingerprint = [
      deploymentId ?? "",
      statusCode ?? "",
      pathName,
      normalizedMessage(message),
    ].join("|");
    const current = groups.get(fingerprint);

    if (current) {
      current.count += 1;
      const date = timestampOf(log);
      if (date && (!current.latest || date > current.latest)) current.latest = date;
      continue;
    }

    groups.set(fingerprint, {
      count: 1,
      latest: timestampOf(log),
      level: String(log.level ?? "unknown"),
      statusCode,
      deploymentId,
      path: pathName,
      message,
      requestId: log.requestId ? String(log.requestId) : null,
    });
  }

  return [...groups.values()].sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return (right.latest?.getTime() ?? 0) - (left.latest?.getTime() ?? 0);
  });
}

export function buildAlert({ logs, collectionFailures, projectName, forceTest = false }) {
  if (logs.length === 0 && collectionFailures.length === 0 && !forceTest) return null;

  const groups = groupLogs(logs);
  const subjectParts = [];
  if (logs.length > 0) subjectParts.push(`${logs.length} 条生产错误`);
  if (collectionFailures.length > 0) subjectParts.push("巡检异常");
  if (forceTest) subjectParts.push("邮件通道测试");

  const lines = [
    `${projectName} Vercel 生产日志巡检`,
    `巡检时间：${formatShanghaiTime(new Date())}（北京时间）`,
    `错误日志：${logs.length} 条，错误签名：${groups.length} 个`,
    "",
  ];

  if (forceTest) {
    lines.push("这是一封手动触发的测试邮件，用于确认 GitHub Actions 和 SMTP 通道可用。", "");
  }

  if (groups.length > 0) {
    lines.push("错误摘要：");
    for (const [index, group] of groups.slice(0, MAX_GROUPS).entries()) {
      lines.push(
        "",
        `${index + 1}. ${group.message}`,
        `   路径：${group.path}`,
        `   级别/状态：${group.level}${group.statusCode ? ` / ${group.statusCode}` : ""}`,
        `   出现次数：${group.count}`,
        `   最近发生：${formatShanghaiTime(group.latest)}`,
      );
      if (group.requestId) lines.push(`   Request ID：${group.requestId}`);
      if (group.deploymentId) lines.push(`   Deployment ID：${group.deploymentId}`);
    }

    if (groups.length > MAX_GROUPS) {
      lines.push("", `另有 ${groups.length - MAX_GROUPS} 个错误签名未在邮件中展开。`);
    }
  }

  if (collectionFailures.length > 0) {
    lines.push("", "巡检过程异常：");
    for (const failure of collectionFailures) lines.push(`- ${failure}`);
  }

  lines.push(
    "",
    "请登录 Vercel 核对完整日志，然后决定是否安排修复。此巡检不会自动修改代码或触发部署。",
  );

  return {
    subject: `[Prompt Lens] ${projectName} ${subjectParts.join("；")}`,
    text: lines.join("\n"),
  };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

async function readOptionalFile(filePath) {
  if (!filePath) return "";
  return readFile(filePath, "utf8");
}

function failureFromCommand(name, exitCode, stderr) {
  if (Number(exitCode) === 0) return null;
  const details = stderr.trim().slice(0, MAX_FAILURE_LENGTH) || `退出码 ${exitCode}`;
  return `${name}：${details}`;
}

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function sendEmail(alert) {
  const moduleRoot = requireEnvironment("MONITOR_NODE_MODULES");
  const requireFromMonitor = createRequire(path.join(moduleRoot, "package.json"));
  const nodemailer = requireFromMonitor("nodemailer");

  const port = Number(process.env.SMTP_PORT ?? "465");
  if (!Number.isInteger(port) || port <= 0) throw new Error("SMTP_PORT must be a positive integer");

  const user = requireEnvironment("SMTP_USER");
  const transporter = nodemailer.createTransport({
    host: requireEnvironment("SMTP_HOST"),
    port,
    secure: (process.env.SMTP_SECURE ?? String(port === 465)).toLowerCase() === "true",
    auth: {
      user,
      pass: requireEnvironment("SMTP_PASS"),
    },
  });

  await transporter.sendMail({
    from: process.env.ALERT_EMAIL_FROM?.trim() || user,
    to: requireEnvironment("ALERT_EMAIL_TO"),
    subject: alert.subject,
    text: alert.text,
  });
}

async function main() {
  const errorOutput = await readOptionalFile(argumentValue("--errors"));
  const serverErrorOutput = await readOptionalFile(argumentValue("--server-errors"));
  const errorStderr = await readOptionalFile(argumentValue("--errors-stderr"));
  const serverErrorStderr = await readOptionalFile(argumentValue("--server-errors-stderr"));
  const collectionFailures = [];

  const errorFailure = failureFromCommand(
    "error/fatal 日志查询",
    argumentValue("--errors-status"),
    errorStderr,
  );
  const serverErrorFailure = failureFromCommand(
    "5xx 日志查询",
    argumentValue("--server-errors-status"),
    serverErrorStderr,
  );
  if (errorFailure) collectionFailures.push(errorFailure);
  if (serverErrorFailure) collectionFailures.push(serverErrorFailure);

  const parsedCollections = [];
  for (const [name, output] of [
    ["error/fatal", errorOutput],
    ["5xx", serverErrorOutput],
  ]) {
    if (!output.trim()) continue;
    try {
      parsedCollections.push(parseJsonLines(output));
    } catch (error) {
      collectionFailures.push(`${name} 日志解析失败：${error.message}`);
    }
  }

  const logs = mergeActionableLogs(...parsedCollections);
  const alert = buildAlert({
    logs,
    collectionFailures,
    projectName: process.env.VERCEL_PROJECT_NAME?.trim() || "prompt-lens",
    forceTest: argumentValue("--test-email") === "true",
  });

  if (!alert) {
    console.log("No new actionable Vercel production errors found.");
    return;
  }

  await sendEmail(alert);
  console.log(`Sent Vercel alert email for ${logs.length} log entries.`);
}

const isEntrypoint = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isEntrypoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
