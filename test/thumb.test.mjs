import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { Jimp, JimpMime } from "jimp";
import { thumbnail } from "../src/thumb.js";

const FIX = path.join(import.meta.dirname, "fixtures", "watch.jpg");

async function noisyPng(size) {
  const img = new Jimp({ width: size, height: size, color: 0x000000ff });
  crypto.randomFillSync(img.bitmap.data);
  for (let i = 3; i < img.bitmap.data.length; i += 4) img.bitmap.data[i] = 255; // keep it fully opaque
  return img.getBuffer(JimpMime.png);
}

test("a normal photo produces a small PNG thumbnail", async () => {
  const t = await thumbnail(await readFile(FIX));
  assert.notEqual(t, null);
  assert.equal(t.mimeType, "image/png");
  assert.ok(Buffer.from(t.data, "base64").length <= 100_000);
});

test("not an image returns null", async () => {
  const t = await thumbnail(Buffer.from("not a png"));
  assert.equal(t, null);
});

test("a very noisy 256px image is retried at 128px to stay under the size cap", async () => {
  const bytes = await noisyPng(256);
  // sanity check: the fixture is deliberately oversized at native 256, so the retry path is really exercised
  assert.ok(bytes.length > 100_000);
  const t = await thumbnail(bytes);
  assert.notEqual(t, null);
  const png = Buffer.from(t.data, "base64");
  assert.ok(png.length <= 100_000);
  const decoded = await Jimp.read(png);
  assert.equal(decoded.bitmap.width, 128);
});

test("a thumbnail still over the cap after the retry is dropped, not sent", async () => {
  const bytes = await noisyPng(256);
  const t = await thumbnail(bytes, { maxBytes: 1 });
  assert.equal(t, null);
});
