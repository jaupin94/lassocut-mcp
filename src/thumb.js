// Small preview the assistant can show in the chat. Pure JS (jimp), so npx works everywhere.
import { Jimp } from "jimp";

const MAX_THUMB_BYTES = 100_000;

async function render(bytes, side) {
  const img = await Jimp.read(bytes);
  img.scaleToFit({ w: side, h: side });
  return img.getBuffer("image/png");
}

export async function thumbnail(bytes, { maxBytes = MAX_THUMB_BYTES } = {}) {
  try {
    let png = await render(bytes, 256);
    if (png.length > maxBytes) png = await render(bytes, 128); // still too heavy at 256px: retry smaller
    if (png.length > maxBytes) return null; // even 128px is too heavy: drop the thumbnail, keep the text result
    return { data: png.toString("base64"), mimeType: "image/png" };
  } catch {
    return null;
  }
}
