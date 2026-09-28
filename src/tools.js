// The three MCP tools. All spending rules live here and in guards.js, never in tool descriptions alone.
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { findKey, saveKey, apiUrl } from "./config.js";
import { expandImages } from "./inputs.js";
import { outputPathFor } from "./outputs.js";
import { createApi } from "./api.js";
import { tooMany, needsConfirmation, confirmationMessage, notEnough } from "./guards.js";
import { thumbnail } from "./thumb.js";

const NO_KEY = "No LassoCut account connected. Call sign_in, or set LASSOCUT_API_KEY.";
const MAX_THUMBS = 3;
const say = (text, isError) => (isError ? { content: [{ type: "text", text }], isError: true } : { content: [{ type: "text", text }] });

export function defaultOpenUrl(url) {
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(cmd, args, { stdio: "ignore", detached: true }).unref(); } catch { /* the URL is also returned as text */ }
}

export function createHandlers({ env = process.env, makeApi = createApi, openUrl = defaultOpenUrl,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), cwd = process.cwd(), version = "1.0.0" } = {}) {
  const api = (key) => makeApi({ apiUrl: apiUrl(env), apiKey: key, version });

  async function removeBackground({ images, size = "preview", background = "transparent", format = "png",
    crop = false, output_dir, confirm_cost = false }) {
    const key = findKey(env);
    if (!key) return say(NO_KEY, true);
    const { items, skipped } = await expandImages(images);
    const limit = tooMany(items.length);
    if (limit) return say(limit, true);
    if (!items.length) return say(["No image to process.", ...skipped.map((s) => `${s.source}: skipped — ${s.reason}`)].join("\n"), true);
    const client = api(key);
    if (size === "full") {
      let balance = null;
      try { balance = (await client.account()).credits; } catch { /* unknown balance: let the API decide */ }
      if (needsConfirmation({ size, count: items.length, confirm: confirm_cost })) return say(confirmationMessage(items.length, balance ?? "unknown"), true);
      const low = notEnough({ size, count: items.length, balance });
      if (low) return say(low, true);
    }
    const fields = { size, format };
    if (background && background !== "transparent") fields.bg_color = String(background).replace(/^#/, "");
    if (crop) fields.crop = "true";
    const taken = new Set(), lines = [], thumbs = [];
    let credits = 0, ok = 0;
    for (const item of items) {
      try {
        const file = item.kind === "file" ? { bytes: await readFile(item.source), name: path.basename(item.source) } : undefined;
        const res = await client.removeBackground({ file, url: item.kind === "url" ? item.source : undefined, fields, idempotencyKey: randomUUID() });
        const out = outputPathFor(item, { format, outputDir: output_dir, cwd, taken });
        await mkdir(path.dirname(out), { recursive: true });
        await writeFile(out, res.bytes);
        credits += res.credits; ok++;
        lines.push(`${item.source} → ${out}`);
        if (thumbs.length < MAX_THUMBS) { const t = await thumbnail(res.bytes); if (t) thumbs.push({ type: "image", ...t }); }
      } catch (e) {
        lines.push(`${item.source}: failed — ${e.message}`);
      }
    }
    for (const s of skipped) lines.push(`${s.source}: skipped — ${s.reason}`);
    lines.push(`Done: ${ok} of ${items.length}. Credits charged: ${Math.round(credits * 100) / 100}.`);
    const result = { content: [{ type: "text", text: lines.join("\n") }, ...thumbs] };
    if (!ok) result.isError = true;
    return result;
  }

  async function getCredits() {
    const key = findKey(env);
    if (!key) return say(NO_KEY, true);
    try {
      const a = await api(key).account();
      return say(`Balance: ${a.credits} credits. Free previews left this month: ${a.freePreviews}.`);
    } catch (e) { return say(e.message, true); }
  }

  async function signIn({ force = false } = {}) {
    if (findKey(env) && !force) return say("Already signed in to LassoCut. Call sign_in with force: true to use another account.");
    let start;
    try { start = await api("").connectStart(); } catch (e) { return say(e.message, true); }
    openUrl(start.verification_url);
    const deadline = Date.now() + Math.min(start.expires_in || 600, 300) * 1000;
    while (Date.now() < deadline) {
      await sleep((start.interval ?? 3) * 1000);
      let got;
      try { got = await api("").connectPoll(start.device_code); } catch { continue; }
      if (got.status === "approved") {
        await saveKey(got.api_key, env);
        return say("Signed in to LassoCut. The key is saved for this connector and the lassocut command-line tool.");
      }
      if (got.status === "denied" || got.status === "expired") break;
    }
    return say(`The connection was not approved. Open ${start.verification_url} and enter the code ${start.user_code}, then call sign_in again.`, true);
  }

  return { removeBackground, getCredits, signIn };
}
