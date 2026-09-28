import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
