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
  const h = createHandlers({ env, makeApi: api.make, home: dir });
  assert.match(text(await h.removeBackground({ images: many })), /Too many images \(51\)/);
  assert.match(text(await h.removeBackground({ images: many.slice(0, 11), size: "full" })), /11 images = 11 credits\. Balance: 3 credits/);
  assert.match(text(await h.removeBackground({ images: many.slice(0, 5), size: "full" })), /Not enough credits: 3 left, 5 needed/);
  assert.equal(api.calls.length, 0);
});

test("size other than preview or full is rejected before any call", async () => {
  const { files, env } = await setup();
  const api = fakeApi({ png: await readFile(FIX) });
  const r = await createHandlers({ env, makeApi: api.make }).removeBackground({ images: files[0], size: "medium" });
  assert.equal(r.isError, true);
  assert.match(text(r), /size must be preview or full/);
  assert.equal(api.calls.length, 0);
});

test("output_dir must be an absolute path", async () => {
  const { files, env } = await setup();
  const r = await createHandlers({ env, makeApi: () => { throw new Error("no call expected"); } })
    .removeBackground({ images: files[0], output_dir: "relative/out" });
  assert.equal(r.isError, true);
  assert.match(text(r), /output_dir must be an absolute path/);
});

test("a leading ~ in output_dir expands to the home folder", async () => {
  const { files, dir, env } = await setup();
  const api = fakeApi({ png: await readFile(FIX) });
  const r = await createHandlers({ env, makeApi: api.make, home: dir }).removeBackground({ images: files[0], output_dir: "~/out" });
  assert.equal(r.isError, undefined);
  assert.ok(existsSync(path.join(dir, "out", "p0-no-bg.png")));
});

test("an output_dir that cannot be created is refused before any image is sent", async () => {
  const { files, dir, env } = await setup();
  const blocker = path.join(dir, "blocked-file");
  await writeFile(blocker, "x");
  const api = fakeApi({ png: await readFile(FIX) });
  const r = await createHandlers({ env, makeApi: api.make })
    .removeBackground({ images: files[0], output_dir: path.join(blocker, "sub") });
  assert.equal(r.isError, true);
  assert.match(text(r), /cannot write to/i);
  assert.equal(api.calls.length, 0);
});

test("a per-item folder that cannot be created fails only that image, before any API call for it", async () => {
  const { dir, env } = await setup();
  const blockerFile = path.join(dir, "blocked-home");
  await writeFile(blockerFile, "x");
  const api = fakeApi({ png: await readFile(FIX) });
  const r = await createHandlers({ env, makeApi: api.make, home: blockerFile }).removeBackground({ images: "https://ex.com/pic.jpg" });
  assert.equal(r.isError, true);
  assert.match(text(r), /https:\/\/ex\.com\/pic\.jpg: failed — cannot write to/);
  assert.equal(api.calls.length, 0);
});

test("a name that appears during the API call (a race) is not overwritten; the next name is used", async () => {
  const { files } = await setup(1);
  const png = await readFile(FIX);
  const expectedFirst = files[0].replace(/\.jpg$/, "-no-bg.png");
  const expectedSecond = files[0].replace(/\.jpg$/, "-no-bg-2.png");
  let raced = false;
  const make = () => ({
    async removeBackground() {
      if (!raced) { raced = true; await writeFile(expectedFirst, "raced-content"); }
      return { bytes: png, credits: 0.25 };
    },
    async account() { return { credits: 100, freePreviews: 50 }; },
  });
  const r = await createHandlers({ env: (await setup()).env, makeApi: make }).removeBackground({ images: files[0] });
  assert.equal(await readFile(expectedFirst, "utf8"), "raced-content");
  assert.ok(existsSync(expectedSecond));
  assert.ok(text(r).includes(path.basename(expectedSecond)));
  assert.equal(r.isError, undefined);
});

test("get_credits reports balance and free previews", async () => {
  const { env } = await setup();
  const r = await createHandlers({ env, makeApi: fakeApi({ balance: 12 }).make }).getCredits();
  assert.equal(text(r), "Balance: 12 credits. Free previews left this month: 50.");
});

test("sign_in returns immediately with the URL and code; approval is saved in the background", async () => {
  const { dir } = await setup();
  const env = { LASSOCUT_CONFIG: path.join(dir, "new.json") };
  const opened = [];
  let polls = 0;
  const make = () => ({
    connectStart: async () => ({ device_code: "d", user_code: "ABCD-EFGH", verification_url: "https://www.lassocut.com/connect/?code=ABCD-EFGH", interval: 0, expires_in: 600 }),
    connectPoll: async () => (++polls < 2 ? { status: "pending" } : { status: "approved", api_key: "newkey" }),
  });
  const h = createHandlers({ env, makeApi: make, openUrl: (u) => opened.push(u), sleep: async () => {} });
  const r = await h.signIn({});
  assert.deepEqual(opened, ["https://www.lassocut.com/connect/?code=ABCD-EFGH"]);
  assert.match(text(r), /^Open https:\/\/www\.lassocut\.com\/connect\/\?code=ABCD-EFGH and approve the connection \(code ABCD-EFGH\)\. Then call get_credits to check\.$/);
  assert.doesNotMatch(text(r), /newkey/);
  for (let i = 0; i < 100 && !existsSync(env.LASSOCUT_CONFIG); i++) await new Promise((res) => setTimeout(res, 5));
  assert.equal(JSON.parse(await readFile(env.LASSOCUT_CONFIG, "utf8")).api_key, "newkey");
});

test("a second sign_in while one is pending reports the same URL and code without starting another", async () => {
  const { dir } = await setup();
  const env = { LASSOCUT_CONFIG: path.join(dir, "new2.json") };
  let starts = 0;
  const make = () => ({
    connectStart: async () => { starts++; return { device_code: "d", user_code: "WXYZ-1234", verification_url: "https://www.lassocut.com/connect/?code=WXYZ-1234", interval: 0, expires_in: 600 }; },
    connectPoll: async () => new Promise(() => {}), // never resolves: stays pending for the duration of the test
  });
  const h = createHandlers({ env, makeApi: make, openUrl: () => {}, sleep: async () => {} });
  const r1 = await h.signIn({});
  assert.match(text(r1), /Open https:\/\/www\.lassocut\.com\/connect\/\?code=WXYZ-1234/);
  const r2 = await h.signIn({});
  assert.match(text(r2), /^Sign-in in progress: open https:\/\/www\.lassocut\.com\/connect\/\?code=WXYZ-1234 \(code WXYZ-1234\)\.$/);
  assert.equal(starts, 1);
});

test("an unsafe verification URL is never handed to the OS opener, but is still shown in text", async () => {
  const { dir } = await setup();
  const env = { LASSOCUT_CONFIG: path.join(dir, "unsafe.json") };
  const opened = [];
  const make = () => ({
    connectStart: async () => ({ device_code: "d", user_code: "ZZZZ-9999", verification_url: 'https://ex.com/a"b', interval: 0, expires_in: 600 }),
    connectPoll: async () => new Promise(() => {}),
  });
  const r = await createHandlers({ env, makeApi: make, openUrl: (u) => opened.push(u), sleep: async () => {} }).signIn({});
  assert.deepEqual(opened, []);
  assert.match(text(r), /https:\/\/ex\.com\/a"b/);
});

test("sign_in with an existing key does nothing unless force", async () => {
  const { env } = await setup();
  const r = await createHandlers({ env, makeApi: () => { throw new Error("no call expected"); } }).signIn({});
  assert.match(text(r), /Already signed in/);
  assert.match(text(r), /Note: LASSOCUT_API_KEY is set and takes precedence\./);
});

test("the default sleep timer is unref'd so a background sign-in poll cannot keep the process alive", async () => {
  const { dir } = await setup();
  const env = { LASSOCUT_CONFIG: path.join(dir, "unref.json") };
  const timers = [];
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn, ms) => { const t = realSetTimeout(fn, ms); timers.push(t); return t; };
  try {
    const make = () => ({
      connectStart: async () => ({ device_code: "d", user_code: "UNRF-0000", verification_url: "https://www.lassocut.com/connect/?code=UNRF-0000", interval: 0, expires_in: 600 }),
      connectPoll: async () => ({ status: "denied" }),
    });
    // No sleep override here: this exercises the real default.
    await createHandlers({ env, makeApi: make, openUrl: () => {} }).signIn({});
  } finally {
    global.setTimeout = realSetTimeout;
  }
  assert.ok(timers.length > 0, "expected the default sleep to schedule a timer");
  for (const t of timers) assert.equal(t.hasRef(), false, "the sleep timer must be unref'd");
});

test("sign_in with force still notes that LASSOCUT_API_KEY takes precedence over a newly saved key", async () => {
  const { dir } = await setup();
  const env = { LASSOCUT_CONFIG: path.join(dir, "new4.json"), LASSOCUT_API_KEY: "envkey" };
  const make = () => ({
    connectStart: async () => ({ device_code: "d", user_code: "AAAA-BBBB", verification_url: "https://www.lassocut.com/connect/?code=AAAA-BBBB", interval: 0, expires_in: 600 }),
    connectPoll: async () => new Promise(() => {}),
  });
  const r = await createHandlers({ env, makeApi: make, openUrl: () => {}, sleep: async () => {} }).signIn({ force: true });
  assert.match(text(r), /Open https:\/\/www\.lassocut\.com\/connect\/\?code=AAAA-BBBB/);
  assert.match(text(r), /Note: LASSOCUT_API_KEY is set and takes precedence\./);
});
