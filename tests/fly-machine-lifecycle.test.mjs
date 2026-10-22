import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createFlyMachineSuspender } from "../workers/ffmpeg-worker/fly-machine-lifecycle.mjs";

test("builds an authenticated local Fly suspension request without an API token", async () => {
  let options;
  const requestImpl = (input, callback) => {
    options = input;
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.destroy = (error) => request.emit("error", error);
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.resume = () => {};
      callback(response);
      queueMicrotask(() => response.emit("end"));
    };
    return request;
  };
  const suspend = createFlyMachineSuspender({ appName: "prompt-lens", machineId: "abc123", requestImpl });

  await suspend();
  assert.equal(options.socketPath, "/.fly/api");
  assert.equal(options.hostname, "flaps");
  assert.equal(options.path, "/v1/apps/prompt-lens/machines/abc123/suspend");
  assert.equal(options.method, "POST");
});

test("stays disabled outside a Fly Machine", () => {
  assert.equal(createFlyMachineSuspender({ appName: "", machineId: "" }), undefined);
});
