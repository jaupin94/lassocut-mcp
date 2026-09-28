// Output file names: "<name>-no-bg.<ext>" next to the original (or in output_dir), never overwriting.
import path from "node:path";
import { existsSync } from "node:fs";

export const OUTPUT_EXT = { png: ".png", jpg: ".jpg", webp: ".webp" };

function baseName(item) {
  if (item.kind === "file") return path.parse(item.source).name;
  let last = "";
  try { last = decodeURIComponent(new URL(item.source).pathname.split("/").filter(Boolean).pop() || ""); } catch {}
  const name = path.parse(last).name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  return name || "image";
}

export function outputPathFor(item, { format, outputDir, cwd = process.cwd(), taken, exists = existsSync }) {
  const dir = outputDir || (item.kind === "file" ? path.dirname(item.source) : cwd);
  const stem = `${baseName(item)}-no-bg`, ext = OUTPUT_EXT[format];
  for (let n = 1; ; n++) {
    const candidate = path.join(dir, `${stem}${n === 1 ? "" : `-${n}`}${ext}`);
    if (!taken.has(candidate) && !exists(candidate)) { taken.add(candidate); return candidate; }
  }
}
