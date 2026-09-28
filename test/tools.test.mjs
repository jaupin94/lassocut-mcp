import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, writeFile, readFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHandlers } from "../src/tools.js";
import { ApiError } from "../src/api.js";

const FIX = path.join(import.meta.dirname, "fixtures", "watch.jpg");

async function setup(n = 1) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lc-tools-"));
  const files = [];
  for (let i = 0; i < n; i++) { const f = path.join(dir, `p${i}.jpg`); await copyFile(FIX, f); files.push(f); }
  return { dir, files, env: { LASSOCUT_CONFIG: path.join(dir, "cfg.json"), LASSOCUT_API_KEY: "k" } };
}

function fakeApi({ fail = new Set(), balance = 100, png } = {}) {
  const calls = [];
  return { calls, make: () => ({
    async removeBackground(req) { calls.push(req); const i = calls.length - 1;
      if (fail.has(i)) throw new ApiError(400, "No clear subject found in this image.");
      return { bytes: png, credits: req.fields.size === "full" ? 1 : 0.25, contentType: "image/png" }; },
    async account() { return { credits: balance, freePreviews: 50 }; },
  }) };
}

const text = (r) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

test("no key → sign_in hint, nothing sent", async () => {
  const { files, dir } = await setup();
  const api = fakeApi({ png: await readFile(FIX) });
  const h = createHandlers({ env: { LASSOCUT_CONFIG: path.join(dir, "none.json") }, makeApi: api.make });
  const r = await h.removeBackground({ images: files[0] });
  assert.equal(r.isError, true);
  assert.match(text(r), /No LassoCut account connected\. Call sign_in, or set LASSOCUT_API_KEY\./);
  assert.equal(api.calls.length, 0);
});

test("preview by default, file written next to original, credits summed, fields mapped", async () => {
  const { files } = await setup(2);
  const api = fakeApi({ png: await readFile(FIX) });
  const h = createHandlers({ env: (await setup()).env, makeApi: api.make });
  const r = await h.removeBackground({ images: files, background: "#ffffff", crop: true, format: "jpg" });
  assert.equal(api.calls[0].fields.size, "preview");
  assert.equal(api.calls[0].fields.bg_color, "ffffff");
  assert.equal(api.calls[0].fields.crop, "true");
  assert.equal(api.calls[0].fields.format, "jpg");
  assert.notEqual(api.calls[0].idempotencyKey, api.calls[1].idempotencyKey);
  assert.ok(existsSync(files[0].replace(/\.jpg$/, "-no-bg.jpg")));
  assert.match(text(r), /Credits charged: 0\.5/);
  assert.equal(r.isError, undefined);
});

test("transparent background sends no bg_color", async () => {
  const { files, env } = await setup();
  const api = fakeApi({ png: await readFile(FIX) });
  await createHandlers({ env, makeApi: api.make }).removeBackground({ images: files[0] });
  assert.equal("bg_color" in api.calls[0].fields, false);
});

test("one failure does not stop the others; isError only if all fail", async () => {
  const { files, env } = await setup(3);
  const api = fakeApi({ fail: new Set([1]), png: await readFile(FIX) });
  const r = await createHandlers({ env, makeApi: api.make }).removeBackground({ images: files });
  assert.equal(api.calls.length, 3);
  assert.match(text(r), /p1\.jpg: failed — No clear subject found in this image\./);
  assert.equal(r.isError, undefined);
  const all = fakeApi({ fail: new Set([0]), png: await readFile(FIX) });
  const r2 = await createHandlers({ env, makeApi: all.make }).removeBackground({ images: files[0] });
  assert.equal(r2.isError, true);
});

test("at most 3 thumbnails", async () => {
  const { files, env } = await setup(4);
  const api = fakeApi({ png: await readFile(FIX) });
  const r = await createHandlers({ env, makeApi: api.make }).removeBackground({ images: files });
  assert.equal(r.content.filter((c) => c.type === "image").length, 3);
});

test("an unreadable result still counts as done, just without thumbnail", async () => {
  const { files, env } = await setup();
  const api = fakeApi({ png: Buffer.from("not a png") });
  const r = await createHandlers({ env, makeApi: api.make }).removeBackground({ images: files[0] });
  assert.equal(r.content.filter((c) => c.type === "image").length, 0);
  assert.match(text(r), /p0\.jpg → .*p0-no-bg\.png/);
});

test("guards: over 50 refused, full over 10 asks confirmation, low balance refused — no image sent", async () => {
  const { dir, env } = await setup();
  const many = Array.from({ length: 51 }, (_, i) => `https://ex.com/${i}.jpg`);
  const api = fakeApi({ balance: 3, png: Buffer.from("") });
  const h = createHandlers({ env, makeApi: api.make, cwd: dir });
  assert.match(text(await h.removeBackground({ images: many })), /Too many images \(51\)/);
  assert.match(text(await h.removeBackground({ images: many.slice(0, 11), size: "full" })), /11 images = 11 credits\. Balance: 3 credits/);
  assert.match(text(await h.removeBackground({ images: many.slice(0, 5), size: "full" })), /Not enough credits: 3 left, 5 needed/);
  assert.equal(api.calls.length, 0);
});

test("get_credits reports balance and free previews", async () => {
  const { env } = await setup();
  const r = await createHandlers({ env, makeApi: fakeApi({ balance: 12 }).make }).getCredits();
  assert.equal(text(r), "Balance: 12 credits. Free previews left this month: 50.");
});

test("sign_in saves the approved key and reports the URL and code", async () => {
  const { dir } = await setup();
  const env = { LASSOCUT_CONFIG: path.join(dir, "new.json") };
  const opened = [];
  let polls = 0;
  const make = () => ({
    connectStart: async () => ({ device_code: "d", user_code: "ABCD-EFGH", verification_url: "https://www.lassocut.com/connect/?code=ABCD-EFGH", interval: 0, expires_in: 600 }),
    connectPoll: async () => (++polls < 2 ? { status: "pending" } : { status: "approved", api_key: "newkey" }),
  });
  const r = await createHandlers({ env, makeApi: make, openUrl: (u) => opened.push(u), sleep: async () => {} }).signIn({});
  assert.deepEqual(opened, ["https://www.lassocut.com/connect/?code=ABCD-EFGH"]);
  assert.equal(JSON.parse(await readFile(env.LASSOCUT_CONFIG, "utf8")).api_key, "newkey");
  assert.match(text(r), /Signed in to LassoCut/);
  assert.doesNotMatch(text(r), /newkey/);
});

test("sign_in with an existing key does nothing unless force", async () => {
  const { env } = await setup();
  const r = await createHandlers({ env, makeApi: () => { throw new Error("no call expected"); } }).signIn({});
  assert.match(text(r), /Already signed in/);
});
