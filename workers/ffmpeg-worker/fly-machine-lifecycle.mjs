import { request as httpRequest } from "node:http";

export function createFlyMachineSuspender({
  appName = process.env.FLY_APP_NAME,
  machineId = process.env.FLY_MACHINE_ID,
  socketPath = "/.fly/api",
  requestImpl = httpRequest,
} = {}) {
  if (!appName || !machineId) return undefined;
  const requestPath = `/v1/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}/suspend`;
  return () => new Promise((resolve, reject) => {
    const request = requestImpl({
      socketPath,
      hostname: "flaps",
      path: requestPath,
      method: "POST",
      headers: { Host: "flaps", "Content-Length": "0" },
    }, (response) => {
      response.resume();
      response.once("end", () => {
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) resolve();
        else reject(new Error(`Fly suspend failed with HTTP ${response.statusCode || 0}`));
      });
    });
    request.setTimeout(10_000, () => request.destroy(new Error("Fly suspend request timed out")));
    request.once("error", reject);
    request.end();
  });
}
