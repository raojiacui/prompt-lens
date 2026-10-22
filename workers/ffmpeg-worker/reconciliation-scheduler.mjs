const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isoTimestamp(now) {
  return new Date(now()).toISOString();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function startReconciliationScheduler({
  baseUrl,
  secret,
  fetchImpl = globalThis.fetch,
  intervalMs = 60_000,
  initialDelayMs = 1_000,
  requestTimeoutMs = 290_000,
  allowInsecureLoopback = false,
  logger = console,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const state = {
    enabled: Boolean(baseUrl && secret),
    running: false,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastStatus: null,
    lastError: null,
    consecutiveFailures: 0,
    nextRunAt: null,
  };
  let timer;
  let stopped = false;

  const snapshot = () => ({ ...state });
  const stop = () => {
    stopped = true;
    state.running = false;
    state.nextRunAt = null;
    if (timer) clearTimer(timer);
  };

  if (!state.enabled) return { snapshot, stop };

  const endpoint = new URL("/api/cron/commercial-reconciliation", baseUrl);
  const isSecure = endpoint.protocol === "https:";
  const isAllowedLocalHttp = allowInsecureLoopback
    && endpoint.protocol === "http:"
    && LOOPBACK_HOSTS.has(endpoint.hostname);
  if (!isSecure && !isAllowedLocalHttp) {
    throw new Error("Commercial reconciliation requires HTTPS or an explicitly enabled loopback target");
  }

  const schedule = (delayMs) => {
    if (stopped) return;
    state.nextRunAt = new Date(now() + delayMs).toISOString();
    timer = setTimer(tick, delayMs);
    timer.unref?.();
  };

  const tick = async () => {
    if (stopped || state.running) return;
    state.running = true;
    state.nextRunAt = null;
    state.lastAttemptAt = isoTimestamp(now);
    state.lastError = null;
    try {
      const response = await fetchImpl(endpoint, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(requestTimeoutMs),
        redirect: "error",
      });
      state.lastStatus = response.status;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.lastSuccessAt = isoTimestamp(now);
      state.consecutiveFailures = 0;
      logger.info("commercial.reconciliation.succeeded", {
        status: response.status,
        attemptedAt: state.lastAttemptAt,
      });
    } catch (error) {
      state.lastStatus = error instanceof Error && /^HTTP \d+$/.test(error.message)
        ? Number(error.message.slice(5))
        : null;
      state.lastError = errorMessage(error);
      state.consecutiveFailures += 1;
      logger.warn("commercial.reconciliation.failed", {
        error: state.lastError,
        attemptedAt: state.lastAttemptAt,
        consecutiveFailures: state.consecutiveFailures,
      });
    } finally {
      state.running = false;
      schedule(intervalMs);
    }
  };

  schedule(initialDelayMs);
  return { snapshot, stop };
}
