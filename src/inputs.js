// What the assistant passed (file, folder, URL, or a list of them) → the images to send.
import path from "node:path";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";

export const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]);
const isImage = (p) => IMAGE_EXT.has(path.extname(p).toLowerCase());
export const MAX_FILE_SIZE = 22 * 1024 * 1024;

export async function expandImages(images, { statFile = stat, readDir = readdir } = {}) {
  const list = Array.isArray(images) ? images : [images];
  const items = [], skipped = [], seen = new Set();
  const add = (kind, source) => {
    const id = kind === "file" ? path.resolve(source) : source;
    if (!seen.has(id)) { seen.add(id); items.push({ kind, source }); }
  };
  // A stat error other than "not found" (e.g. EACCES, a broken symlink) must not crash the
  // whole call: the offending path is skipped and the rest of the batch still runs.
  const reasonFor = (e) => (e?.code === "ENOENT" ? "file not found" : "cannot read");
  // A file's size is checked here, before it is ever read into memory or sent to the API.
  const addFileChecked = async (p) => {
    let size;
    try { size = (await statFile(p)).size; } catch (e) { skipped.push({ source: p, reason: reasonFor(e) }); return; }
    if (size > MAX_FILE_SIZE) { skipped.push({ source: p, reason: "file too large (max 22 MB)" }); return; }
    add("file", p);
  };
  for (const raw of list) {
    const source = String(raw).trim();
    if (/^https?:\/\//i.test(source)) { add("url", source); continue; }
    if (!existsSync(source)) { skipped.push({ source, reason: "file not found" }); continue; }
    let st;
    try { st = await statFile(source); } catch (e) { skipped.push({ source, reason: reasonFor(e) }); continue; }
    if (st.isDirectory()) {
      let entries;
      try { entries = await readDir(source, { withFileTypes: true }); } catch { skipped.push({ source, reason: "cannot read" }); continue; }
      const names = entries.filter((d) => d.isFile()).map((d) => d.name).sort();
      for (const n of names) {
        const p = path.join(source, n);
        if (isImage(n)) await addFileChecked(p); else skipped.push({ source: p, reason: "not an image" });
      }
    } else if (isImage(source)) await addFileChecked(source);
    else skipped.push({ source, reason: "not an image" });
  }
  return { items, skipped };
}
