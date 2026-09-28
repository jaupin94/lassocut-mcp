import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApi, ApiError } from "../src/api.js";

function server(handler) {
  return new Promise((resolve) => {
    const calls = [];
    const s = http.createServer((req, res) => {
      let body = [];
      req.on("data", (c) => body.push(c));
      req.on("end", () => { calls.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(body) }); handler(req, res, calls.length); });
    });
    s.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${s.address().port}/v1.0`, calls, close: () => s.close() }));
  });
}
const noSleep = async () => {};

test("removeBackground sends key, client and idempotency headers and returns bytes + credits", async () => {
  const srv = await server((req, res) => { res.writeHead(200, { "Content-Type": "image/png", "X-Credits-Charged": "0.25" }); res.end("PNG"); });
  const api = createApi({ apiUrl: srv.url, apiKey: "k", sleep: noSleep, version: "1.0.0" });
  const r = await api.removeBackground({ file: { bytes: Buffer.from("img"), name: "a.jpg" }, fields: { size: "preview" }, idempotencyKey: "id-1" });
  srv.close();
  assert.equal(r.bytes.toString(), "PNG");
  assert.equal(r.credits, 0.25);
  const h = srv.calls[0].headers;
  assert.equal(h["x-api-key"], "k");
  assert.equal(h["x-lassocut-client"], "mcp");
  assert.equal(h["idempotency-key"], "id-1");
  assert.match(srv.calls[0].body.toString(), /name="size"\r\n\r\npreview/);
});

test("502/503/504 are retried with the same idempotency key, 3 attempts max", async () => {
  const srv = await server((req, res, n) => { if (n < 3) { res.writeHead(n === 1 ? 502 : 504); res.end("<html>bad gateway</html>"); } else { res.writeHead(200, { "X-Credits-Charged": "0" }); res.end("ok"); } });
  const api = createApi({ apiUrl: srv.url, apiKey: "k", sleep: noSleep });
  await api.removeBackground({ url: "https://ex.com/a.jpg", fields: {}, idempotencyKey: "same" });
  srv.close();
  assert.equal(srv.calls.length, 3);
  assert.deepEqual(srv.calls.map((c) => c.headers["idempotency-key"]), ["same", "same", "same"]);
});

test("busy after 3 attempts, even with an HTML body", async () => {
  const srv = await server((req, res) => { res.writeHead(503, { "Content-Type": "text/html" }); res.end("<html>x</html>"); });
  const api = createApi({ apiUrl: srv.url, apiKey: "k", sleep: noSleep });
  await assert.rejects(api.removeBackground({ url: "https://ex.com/a.jpg", fields: {}, idempotencyKey: "i" }),
    (e) => e instanceof ApiError && e.message === "LassoCut servers are busy, please retry in a minute.");
  srv.close();
  assert.equal(srv.calls.length, 3);
});

for (const [status, body, headers, expected] of [
  [402, { errors: [{ code: "insufficient_credits", title: "Insufficient credits" }] }, {}, /^Not enough credits\. Buy a pack at https:\/\/www\.lassocut\.com\/account\/ or use size: preview\.$/],
  [403, { errors: [{ title: "API Key invalid" }] }, {}, /^The LassoCut key was rejected\. Call sign_in with force: true\.$/],
  [429, { errors: [{ title: "Rate limit exceeded" }] }, { "Retry-After": "7" }, /^Rate limit reached, retry in 7 seconds\.$/],
  [400, { errors: [{ code: "unknown_foreground", title: "Could not identify foreground in image." }] }, {}, /^No clear subject found in this image\.$/],
  [400, { errors: [{ code: "file_too_large", title: "File too large", detail: "File exceeds limit of 22MB" }] }, {}, /^File too large: File exceeds limit of 22MB$/],
]) {
  test(`HTTP ${status} → readable message`, async () => {
    const srv = await server((req, res) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(body)); });
    const api = createApi({ apiUrl: srv.url, apiKey: "k", sleep: noSleep });
    await assert.rejects(api.removeBackground({ url: "https://ex.com/a.jpg", fields: {}, idempotencyKey: "i" }), (e) => e.status === status && expected.test(e.message));
    srv.close();
  });
}

test("network failure → could not reach", async () => {
  const api = createApi({ apiUrl: "http://127.0.0.1:1/v1.0", apiKey: "k", sleep: noSleep });
  await assert.rejects(api.account(), (e) => e.message === "Could not reach LassoCut, check the connection.");
});

test("account maps credits and free previews", async () => {
  const srv = await server((req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ data: { attributes: { credits: { total: 12.5 }, api: { free_calls: 40 } } } })); });
  const api = createApi({ apiUrl: srv.url, apiKey: "k", sleep: noSleep });
  assert.deepEqual(await api.account(), { credits: 12.5, freePreviews: 40 });
  srv.close();
  assert.equal(srv.calls[0].url, "/v1.0/account");
});

test("connect start/poll post JSON with client mcp and no key", async () => {
  const srv = await server((req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ status: "pending" })); });
  const api = createApi({ apiUrl: srv.url, apiKey: "", sleep: noSleep });
  await api.connectStart();
  await api.connectPoll("dev1");
  srv.close();
  assert.deepEqual(JSON.parse(srv.calls[0].body), { client: "mcp" });
  assert.equal(srv.calls[0].url, "/v1.0/connect/start");
  assert.deepEqual(JSON.parse(srv.calls[1].body), { device_code: "dev1" });
  assert.equal(srv.calls[0].headers["x-api-key"], undefined);
});
