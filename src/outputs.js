// Output file names: "<name>-no-bg.<ext>" next to the original (or in output_dir), never overwriting.
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";

export const OUTPUT_EXT = { png: ".png", jpg: ".jpg", webp: ".webp" };

const MAX_BASE_NAME = 100;

function baseName(item) {
  if (item.kind === "file") return path.parse(item.source).name.slice(0, MAX_BASE_NAME);
  let last = "";
  try { last = decodeURIComponent(new URL(item.source).pathname.split("/").filter(Boolean).pop() || ""); } catch {}
  // Sanitize the decoded segment before path.parse: an encoded separator (%2F, %5C) must become "_",
  // never be read back as a real path separator that would smuggle in extra directory parts.
  const safe = last.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  const name = path.parse(safe).name || "image";
  return name.slice(0, MAX_BASE_NAME);
}

// Expands a leading "~" and refuses a relative output_dir. Validated once, before any file is written.
export function resolveOutputDir(outputDir, home = os.homedir()) {
  if (!outputDir) return null;
  let dir = outputDir;
  if (dir === "~") dir = home;
  else if (dir.startsWith("~/") || dir.startsWith("~\\")) dir = path.join(home, dir.slice(2));
  if (!path.isAbsolute(dir)) throw new Error("output_dir must be an absolute path");
  return dir;
}

function defaultUrlDir(home, exists) {
  const downloads = path.join(home, "Downloads");
  return exists(downloads) ? downloads : home;
}

export function outputPathFor(item, { format, outputDir, home = os.homedir(), taken, exists = existsSync }) {
  const dir = outputDir || (item.kind === "file" ? path.dirname(item.source) : defaultUrlDir(home, exists));
  // The "-no-bg" suffix also guarantees the stem can never collide with a Windows reserved name (CON, NUL, ...).
  const stem = `${baseName(item)}-no-bg`, ext = OUTPUT_EXT[format];
  for (let n = 1; ; n++) {
    const candidate = path.join(dir, `${stem}${n === 1 ? "" : `-${n}`}${ext}`);
    if (!taken.has(candidate) && !exists(candidate)) { taken.add(candidate); return candidate; }
  }
}
