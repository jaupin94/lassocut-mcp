// What the assistant passed (file, folder, URL, or a list of them) → the images to send.
import path from "node:path";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";

export const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]);
const isImage = (p) => IMAGE_EXT.has(path.extname(p).toLowerCase());

export async function expandImages(images) {
  const list = Array.isArray(images) ? images : [images];
  const items = [], skipped = [], seen = new Set();
  const add = (kind, source) => {
    const id = kind === "file" ? path.resolve(source) : source;
    if (!seen.has(id)) { seen.add(id); items.push({ kind, source }); }
  };
  for (const raw of list) {
    const source = String(raw).trim();
    if (/^https?:\/\//i.test(source)) { add("url", source); continue; }
    if (!existsSync(source)) { skipped.push({ source, reason: "file not found" }); continue; }
    if ((await stat(source)).isDirectory()) {
      const names = (await readdir(source, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name).sort();
      for (const n of names) {
        const p = path.join(source, n);
        if (isImage(n)) add("file", p); else skipped.push({ source: p, reason: "not an image" });
      }
    } else if (isImage(source)) add("file", source);
    else skipped.push({ source, reason: "not an image" });
  }
  return { items, skipped };
}
