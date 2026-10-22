import assert from "node:assert/strict";
import test from "node:test";
import { startReconciliationScheduler } from "../workers/ffmpeg-worker/reconciliation-scheduler.mjs";

function controlledTimers() {
  const scheduled = [];
  return {
    scheduled,
    setTimer(callback, delay) {
      const timer = { callback, delay, unref() {} };
      scheduled.push(timer);
      return timer;
    },
    clearTimer(timer) {
      const index = scheduled.indexOf(timer);
      if (index >= 0) scheduled.splice(index, 1);
    },
  };
}

test("records successful reconciliation ticks and schedules the next run", async () => {
  const timers = controlledTimers();
  const requests = [];
  let currentTime = Date.parse("2026-10-22T00:00:00.000Z");
  const scheduler = startReconciliationScheduler({
    baseUrl: "http://127.0.0.1:3000",
    secret: "test-secret",
    allowInsecureLoopback: true,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return { ok: true, status: 200, json: async () => ({ workRemaining: true }) };
    },
    logger: { info() {}, warn() {} },
    now: () => currentTime,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  assert.equal(timers.scheduled[0].delay, 1_000);
  currentTime += 1_000;
  await timers.scheduled.shift().callback();

  assert.equal(requests[0].url, "http://127.0.0.1:3000/api/cron/commercial-reconciliation");
  assert.equal(requests[0].options.headers.Authorization, "Bearer test-secret");
  assert.deepEqual(scheduler.snapshot(), {
    enabled: true,
    running: false,
    suspending: false,
    idlePasses: 0,
    lastWorkRemaining: true,
    lastAttemptAt: "2026-10-22T00:00:01.000Z",
    lastSuccessAt: "2026-10-22T00:00:01.000Z",
    lastStatus: 200,
    lastError: null,
    lastSuspendAttemptAt: null,
    lastSuspendError: null,
    consecutiveFailures: 0,
    nextRunAt: "2026-10-22T00:01:01.000Z",
  });
  assert.equal(timers.scheduled[0].delay, 60_000);
});

test("keeps failure details without exposing the target or secret", async () => {
  const timers = controlledTimers();
  const scheduler = startReconciliationScheduler({
    baseUrl: "https://prompt-lens.example",
    secret: "private-secret",
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    logger: { info() {}, warn() {} },
    now: () => Date.parse("2026-10-22T00:00:00.000Z"),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  await timers.scheduled.shift().callback();
  const snapshot = scheduler.snapshot();
  assert.equal(snapshot.lastStatus, 503);
  assert.equal(snapshot.lastError, "HTTP 503");
  assert.equal(snapshot.consecutiveFailures, 1);
  assert.equal(JSON.stringify(snapshot).includes("private-secret"), false);
  assert.equal(JSON.stringify(snapshot).includes("prompt-lens.example"), false);
});

test("rejects insecure non-loopback reconciliation targets", () => {
  assert.throws(() => startReconciliationScheduler({
    baseUrl: "http://example.com",
    secret: "test-secret",
  }), /requires HTTPS/);
});

test("reports a disabled scheduler when configuration is incomplete", () => {
  const scheduler = startReconciliationScheduler({ baseUrl: "https://example.com" });
  assert.equal(scheduler.snapshot().enabled, false);
  assert.equal(scheduler.snapshot().nextRunAt, null);
});

test("suspends after three empty scans and a wake request schedules an immediate scan", async () => {
  const timers = controlledTimers();
  let suspendCalls = 0;
  const scheduler = startReconciliationScheduler({
    baseUrl: "https://prompt-lens.example",
    secret: "test-secret",
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ workRemaining: false }) }),
    suspendMachine: async () => { suspendCalls += 1; },
    logger: { info() {}, warn() {} },
    now: () => Date.parse("2026-10-22T00:00:00.000Z"),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  await timers.scheduled.shift().callback();
  await timers.scheduled.shift().callback();
  await timers.scheduled.shift().callback();
  assert.equal(suspendCalls, 1);
  assert.equal(scheduler.snapshot().idlePasses, 3);

  assert.equal(scheduler.wake(), true);
  assert.equal(scheduler.snapshot().idlePasses, 0);
  assert.equal(timers.scheduled.at(-1).delay, 0);
});

test("does not count an empty scan while local media work is active", async () => {
  const timers = controlledTimers();
  const scheduler = startReconciliationScheduler({
    baseUrl: "https://prompt-lens.example",
    secret: "test-secret",
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ workRemaining: false }) }),
    hasLocalWork: () => true,
    suspendMachine: async () => { throw new Error("must not suspend"); },
    logger: { info() {}, warn() {} },
    now: () => Date.parse("2026-10-22T00:00:00.000Z"),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  await timers.scheduled.shift().callback();
  assert.equal(scheduler.snapshot().idlePasses, 0);
  assert.equal(scheduler.snapshot().lastSuspendAttemptAt, null);
});
