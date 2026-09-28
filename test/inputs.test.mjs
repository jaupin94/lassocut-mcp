import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, writeFile, stat, readdir } from "node:fs/promises";
import { expandImages } from "../src/inputs.js";

async function tree() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lc-in-"));
  const photos = path.join(dir, "Mes photos été");
  await mkdir(path.join(photos, "sub"), { recursive: true });
  for (const n of ["b.png", "a.JPG", "notes.txt", "sub/c.webp"]) await writeFile(path.join(photos, n), "x");
  return { dir, photos };
}

test("a folder gives its images, sorted, not recursive, other files skipped", async () => {
  const { photos } = await tree();
  const r = await expandImages(photos);
  assert.deepEqual(r.items.map((i) => path.basename(i.source)), ["a.JPG", "b.png"]);
  assert.deepEqual(r.skipped.map((s) => [path.basename(s.source), s.reason]), [["notes.txt", "not an image"]]);
});

test("files with spaces and accents are kept as files", async () => {
  const { photos } = await tree();
  const f = path.join(photos, "b.png");
  assert.deepEqual((await expandImages([f])).items, [{ kind: "file", source: f }]);
});

test("URLs, missing files, non-images and duplicates", async () => {
  const { photos } = await tree();
  const f = path.join(photos, "a.JPG");
  const r = await expandImages(["https://ex.com/p.jpg", f, f, path.join(photos, "nope.png"), path.join(photos, "notes.txt")]);
  assert.deepEqual(r.items, [{ kind: "url", source: "https://ex.com/p.jpg" }, { kind: "file", source: f }]);
  assert.deepEqual(r.skipped.map((s) => s.reason), ["file not found", "not an image"]);
});

test("a file over 22 MB is skipped before being read, not sent", async () => {
  const { photos } = await tree();
  const big = path.join(photos, "huge.jpg");
  await writeFile(big, "x");
  const statFile = async (p) => (p === big ? { isDirectory: () => false, size: 23 * 1024 * 1024 } : stat(p));
  const r = await expandImages([big], { statFile });
  assert.deepEqual(r.items, []);
  assert.deepEqual(r.skipped, [{ source: big, reason: "file too large (max 22 MB)" }]);
});

test("an oversized file inside a folder is skipped, the others in the folder are not", async () => {
  const { photos } = await tree();
  const big = path.join(photos, "z-huge.png");
  await writeFile(big, "x");
  const statFile = async (p) => (p === big ? { isDirectory: () => false, size: 23 * 1024 * 1024 } : stat(p));
  const r = await expandImages(photos, { statFile });
  assert.deepEqual(r.items.map((i) => path.basename(i.source)), ["a.JPG", "b.png"]);
  assert.ok(r.skipped.some((s) => path.basename(s.source) === "z-huge.png" && s.reason === "file too large (max 22 MB)"));
});

test("a stat error other than not-found (e.g. EACCES) on a file is skipped, not thrown", async () => {
  const { photos } = await tree();
  const f = path.join(photos, "a.JPG");
  const eacces = Object.assign(new Error("permission denied"), { code: "EACCES" });
  const statFile = async (p) => { if (p === f) throw eacces; return stat(p); };
  const r = await expandImages([f], { statFile });
  assert.deepEqual(r.items, []);
  assert.deepEqual(r.skipped, [{ source: f, reason: "cannot read" }]);
});

test("a stat error on a folder path itself is skipped, not thrown; other sources still processed", async () => {
  const { photos } = await tree();
  const other = path.join(photos, "a.JPG");
  const eacces = Object.assign(new Error("permission denied"), { code: "EACCES" });
  const statFile = async (p) => { if (p === photos) throw eacces; return stat(p); };
  const r = await expandImages([photos, other], { statFile });
  assert.deepEqual(r.items, [{ kind: "file", source: other }]);
  assert.ok(r.skipped.some((s) => s.source === photos && s.reason === "cannot read"));
});

test("a readdir error on a folder is skipped, not thrown", async () => {
  const { photos } = await tree();
  const eacces = Object.assign(new Error("permission denied"), { code: "EACCES" });
  const readDir = async (p, opts) => { if (p === photos) throw eacces; return readdir(p, opts); };
  const r = await expandImages([photos], { readDir });
  assert.deepEqual(r.items, []);
  assert.deepEqual(r.skipped, [{ source: photos, reason: "cannot read" }]);
});
