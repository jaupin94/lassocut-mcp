// Small preview the assistant can show in the chat. Pure JS (jimp), so npx works everywhere.
import { Jimp } from "jimp";

export async function thumbnail(bytes) {
  try {
    const img = await Jimp.read(bytes);
    img.scaleToFit({ w: 256, h: 256 });
    const png = await img.getBuffer("image/png");
    return { data: png.toString("base64"), mimeType: "image/png" };
  } catch {
    return null;
  }
}
