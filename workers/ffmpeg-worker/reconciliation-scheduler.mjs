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
  idlePassesBeforeSuspend = 3,
  allowInsecureLoopback = false,
  hasLocalWork = () => false,
  suspendMachine,
  logger = console,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const state = {
    enabled: Boolean(baseUrl && secret),
    running: false,
    suspending: false,
    idlePasses: 0,
    lastWorkRemaining: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastStatus: null,
    lastError: null,
    lastSuspendAttemptAt: null,
    lastSuspendError: null,
    consecutiveFailures: 0,
    nextRunAt: null,
  };
  let timer;
  let stopped = false;
  let wakeRequested = false;

  const snapshot = () => ({ ...state });
  const stop = () => {
    stopped = true;
    wakeRequested = false;
    state.running = false;
    state.nextRunAt = null;
    if (timer) clearTimer(timer);
    timer = undefined;
  };

  if (!state.enabled) return { snapshot, stop, wake: () => false };

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
    if (timer) clearTimer(timer);
    state.nextRunAt = new Date(now() + delayMs).toISOString();
    timer = setTimer(tick, delayMs);
    timer.unref?.();
  };

  const wake = () => {
    if (stopped) return false;
    state.idlePasses = 0;
    state.lastSuspendError = null;
    wakeRequested = true;
    if (!state.running && !state.suspending) {
      wakeRequested = false;
      schedule(0);
    }
    return true;
  };

  const tick = async () => {
    timer = undefined;
    if (stopped || state.running) return;
    state.running = true;
    state.nextRunAt = null;
    state.lastAttemptAt = isoTimestamp(now);
    state.lastError = null;
    let shouldSuspend = false;
    try {
      const response = await fetchImpl(endpoint, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(requestTimeoutMs),
        redirect: "error",
      });
      state.lastStatus = response.status;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (typeof payload?.workRemaining !== "boolean") throw new Error("Invalid reconciliation response");
      state.lastWorkRemaining = payload.workRemaining;
      state.lastSuccessAt = isoTimestamp(now);
      state.consecutiveFailures = 0;
      const localWork = hasLocalWork();
      state.idlePasses = payload.workRemaining || localWork ? 0 : state.idlePasses + 1;
      shouldSuspend = Boolean(suspendMachine) && state.idlePasses >= idlePassesBeforeSuspend && !localWork;
      logger.info("commercial.reconciliation.succeeded", {
        status: response.status,
        workRemaining: payload.workRemaining,
        idlePasses: state.idlePasses,
        attemptedAt: state.lastAttemptAt,
      });
    } catch (error) {
      state.lastStatus = error instanceof Error && /^HTTP \d+$/.test(error.message)
        ? Number(error.message.slice(5))
        : null;
      state.lastError = errorMessage(error);
      state.lastWorkRemaining = null;
      state.idlePasses = 0;
      state.consecutiveFailures += 1;
      logger.warn("commercial.reconciliation.failed", {
        error: state.lastError,
        attemptedAt: state.lastAttemptAt,
        consecutiveFailures: state.consecutiveFailures,
      });
    }

    if (shouldSuspend) {
      state.suspending = true;
      state.lastSuspendAttemptAt = isoTimestamp(now);
      state.lastSuspendError = null;
      try {
        await suspendMachine();
      } catch (error) {
        state.lastSuspendError = errorMessage(error);
        state.idlePasses = 0;
        logger.warn("commercial.reconciliation.suspend_failed", { error: state.lastSuspendError });
      } finally {
        state.suspending = false;
      }
    }

    state.running = false;
    const delay = wakeRequested ? 0 : intervalMs;
    wakeRequested = false;
    schedule(delay);
  };

  schedule(initialDelayMs);
  return { snapshot, stop, wake };
}
