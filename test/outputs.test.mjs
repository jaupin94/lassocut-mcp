import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { outputPathFor, resolveOutputDir } from "../src/outputs.js";

const none = () => false;

test("next to the original, -no-bg suffix, chosen extension", () => {
  const p = outputPathFor({ kind: "file", source: path.join("D:", "Mes photos", "été.jpg") },
    { format: "png", taken: new Set(), exists: none });
  assert.equal(p, path.join("D:", "Mes photos", "été-no-bg.png"));
});

test("never overwrites an existing file", () => {
  const dir = path.join("x");
  const existing = new Set([path.join(dir, "a-no-bg.png"), path.join(dir, "a-no-bg-2.png")]);
  const p = outputPathFor({ kind: "file", source: path.join(dir, "a.jpg") },
    { format: "png", taken: new Set(), exists: (q) => existing.has(q) });
  assert.equal(p, path.join(dir, "a-no-bg-3.png"));
});

test("same name twice in one batch with output_dir gives two files", () => {
  const taken = new Set();
  const opts = { format: "jpg", outputDir: "out", taken, exists: none };
  const a = outputPathFor({ kind: "file", source: path.join("a", "photo.png") }, opts);
  const b = outputPathFor({ kind: "file", source: path.join("b", "photo.png") }, opts);
  assert.deepEqual([a, b], [path.join("out", "photo-no-bg.jpg"), path.join("out", "photo-no-bg-2.jpg")]);
});

test("a URL without output_dir is named from its last path part and saved in the home folder (no Downloads here)", () => {
  const opts = { format: "webp", home: "home", taken: new Set(), exists: none };
  assert.equal(outputPathFor({ kind: "url", source: "https://ex.com/img/shoe%20red.jpg?x=1" }, opts),
    path.join("home", "shoe red-no-bg.webp"));
  assert.equal(outputPathFor({ kind: "url", source: "https://ex.com/" }, opts), path.join("home", "image-no-bg.webp"));
});

test("a URL without output_dir is saved in <home>/Downloads when that folder exists", () => {
  const downloads = path.join("home", "Downloads");
  const opts = { format: "png", home: "home", taken: new Set(), exists: (p) => p === downloads };
  assert.equal(outputPathFor({ kind: "url", source: "https://ex.com/a.jpg" }, opts), path.join(downloads, "a-no-bg.png"));
});

test("an encoded slash or backslash in a URL name is sanitized before path parsing, not read as a separator", () => {
  const opts = () => ({ format: "png", home: "home", taken: new Set(), exists: none });
  assert.equal(outputPathFor({ kind: "url", source: "https://ex.com/a%2Fb.jpg" }, opts()),
    path.join("home", "a_b-no-bg.png"));
  assert.equal(outputPathFor({ kind: "url", source: "https://ex.com/a%5Cb.jpg" }, opts()),
    path.join("home", "a_b-no-bg.png"));
});

test("resolveOutputDir expands a leading ~ to the home folder", () => {
  assert.equal(resolveOutputDir("~", "/home/j"), "/home/j");
  assert.equal(resolveOutputDir("~/out", "/home/j"), path.join("/home/j", "out"));
  assert.equal(resolveOutputDir(null, "/home/j"), null);
});

test("resolveOutputDir refuses a relative path", () => {
  assert.throws(() => resolveOutputDir("relative/dir", "/home/j"), /output_dir must be an absolute path/);
  assert.throws(() => resolveOutputDir("out", "/home/j"), /output_dir must be an absolute path/);
});

test("resolveOutputDir accepts an absolute path unchanged", () => {
  assert.equal(resolveOutputDir(path.resolve("/abs/out"), "/home/j"), path.resolve("/abs/out"));
});

test("the base name is capped at 100 characters", () => {
  const long = "a".repeat(150);
  const opts = { format: "png", taken: new Set(), exists: none };
  const p = outputPathFor({ kind: "file", source: path.join("dir", `${long}.jpg`) }, opts);
  assert.equal(path.basename(p), `${"a".repeat(100)}-no-bg.png`);
});
