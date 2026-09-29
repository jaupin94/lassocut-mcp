// The three MCP tools. All spending rules live here and in guards.js, never in tool descriptions alone.
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { findKey, saveKey, apiUrl } from "./config.js";
import { expandImages } from "./inputs.js";
import { outputPathFor, resolveOutputDir } from "./outputs.js";
import { createApi, ApiError } from "./api.js";
import { tooMany, needsConfirmation, confirmationMessage, notEnough } from "./guards.js";
import { thumbnail } from "./thumb.js";

const NO_KEY = "No LassoCut account connected. Call sign_in, or set LASSOCUT_API_KEY.";
const MAX_THUMBS = 3;
// Never hand an unsafe string to the OS's URL opener; it is still returned in the text either way.
const SAFE_URL = /^https?:\/\/[^\s"<>|^&%`]+$/;
const ENV_KEY_NOTE = " Note: LASSOCUT_API_KEY is set and takes precedence.";
const say = (text, isError) => (isError ? { content: [{ type: "text", text }], isError: true } : { content: [{ type: "text", text }] });

function envKeyActive(env) {
  const v = typeof env.LASSOCUT_API_KEY === "string" ? env.LASSOCUT_API_KEY.trim() : "";
  return Boolean(v) && !v.startsWith("${");
}

export function defaultOpenUrl(url) {
  const [cmd, args] = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(cmd, args, { stdio: "ignore", detached: true }).unref(); } catch { /* the URL is also returned as text */ }
}

export function createHandlers({ env = process.env, makeApi = createApi, openUrl = defaultOpenUrl,
  sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); }),
  home = os.homedir(), version = "1.0.0" } = {}) {
  const api = (key) => makeApi({ apiUrl: apiUrl(env), apiKey: key, version });
  // A device-code sign-in in progress: { url, code, promise }. Only one at a time; the promise
  // resolves (and clears this) once the background poll is approved, denied, expired, or times out.
  let pending = null;

  async function removeBackground({ images, size = "preview", background = "transparent", format = "png",
    crop = false, output_dir, confirm_cost = false }, extra = {}) {
    const signal = extra?.mcpReq?.signal;
    const progressToken = extra?.mcpReq?._meta?.progressToken;
    const notify = extra?.mcpReq?.notify;
    const sendProgress = async (done, total) => {
      if (progressToken == null || typeof notify !== "function") return;
      try {
        await notify({ method: "notifications/progress", params: { progressToken, progress: done, total, message: `${done}/${total} images` } });
      } catch { /* best-effort: a failed progress notification must not affect the result */ }
    };
    if (size !== "preview" && size !== "full") return say("size must be preview or full", true);
    const key = findKey(env);
    if (!key) return say(NO_KEY, true);
    let outputDir;
    try { outputDir = resolveOutputDir(output_dir, home); } catch (e) { return say(e.message, true); }
    if (outputDir) {
      try {
        await mkdir(outputDir, { recursive: true });
        await access(outputDir, fsConstants.W_OK);
      } catch {
        return say(`Cannot write to output_dir: ${outputDir}.`, true);
      }
    }
    const { items, skipped } = await expandImages(images);
    const limit = tooMany(items.length);
    if (limit) return say(limit, true);
    if (!items.length) return say(["No image to process.", ...skipped.map((s) => `${s.source}: skipped — ${s.reason}`)].join("\n"), true);
    const client = api(key);
    if (size === "full") {
      let balance = null;
      try { balance = (await client.account()).credits; } catch { /* unknown balance: let the API decide */ }
      if (needsConfirmation({ size, count: items.length, confirm: confirm_cost })) return say(confirmationMessage(items.length, balance), true);
      const low = notEnough({ size, count: items.length, balance });
      if (low) return say(low, true);
    }
    const fields = { size, format };
    if (background && background !== "transparent") fields.bg_color = String(background).replace(/^#/, "");
    if (crop) fields.crop = "true";
    const taken = new Set(), lines = [], thumbs = [];
    let credits = 0, ok = 0;

    // Returns true when the batch must stop (not enough credits): the caller then marks the
    // remaining, not-yet-attempted images as skipped rather than sending them.
    async function processItem(item) {
      let out;
      try {
        out = outputPathFor(item, { format, outputDir, home, taken });
      } catch (e) {
        lines.push(`${item.source}: failed — ${e.message}`);
        return false;
      }
      const dir = path.dirname(out);
      try {
        await mkdir(dir, { recursive: true });
      } catch {
        lines.push(`${item.source}: failed — cannot write to ${dir}`);
        return false;
      }
      try {
        const file = item.kind === "file" ? { bytes: await readFile(item.source), name: path.basename(item.source) } : undefined;
        // Content-derived: the same image + the same settings always produce the same key, so a
        // retried tool call replays for free within the API's idempotency window instead of
        // spending credits again.
        const keyContent = item.kind === "file" ? file.bytes : Buffer.from(item.source, "utf8");
        const idempotencyKey = createHash("sha256").update(keyContent).update(JSON.stringify(fields)).digest("hex").slice(0, 64);
        const res = await client.removeBackground({ file, url: item.kind === "url" ? item.source : undefined, fields, idempotencyKey });
        credits += res.credits; // charged the instant the API answers, whatever happens to the local write next
        let target = out;
        for (;;) {
          try { await writeFile(target, res.bytes, { flag: "wx" }); break; }
          catch (e) {
            if (e.code !== "EEXIST") throw e;
            taken.add(target); // something else claimed this exact name since we computed it: try the next one
            target = outputPathFor(item, { format, outputDir, home, taken });
          }
        }
        ok++;
        lines.push(`${item.source} → ${target}`);
        if (thumbs.length < MAX_THUMBS) { const t = await thumbnail(res.bytes); if (t) thumbs.push({ type: "image", ...t }); }
        return false;
      } catch (e) {
        lines.push(`${item.source}: failed — ${e.message}`);
        return e instanceof ApiError && e.status === 402;
      }
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (signal?.aborted) {
        for (let j = i; j < items.length; j++) lines.push(`${items[j].source}: skipped — cancelled`);
        break;
      }
      const outOfCredits = await processItem(item);
      await sendProgress(i + 1, items.length);
      if (outOfCredits) {
        for (let j = i + 1; j < items.length; j++) lines.push(`${items[j].source}: skipped — not enough credits`);
        break;
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
      return say(`Balance: ${a.credits} credits. Free previews available now: ${a.freePreviews} (50 a month, up to 10 a day).`);
    } catch (e) { return say(e.message, true); }
  }

  async function signIn({ force = false } = {}) {
    if (findKey(env) && !force) {
      return say(`Already signed in to LassoCut. Call sign_in with force: true to use another account.${envKeyActive(env) ? ENV_KEY_NOTE : ""}`);
    }
    if (pending) {
      return say(`Sign-in in progress: open ${pending.url} (code ${pending.code}).${envKeyActive(env) ? ENV_KEY_NOTE : ""}`);
    }
    let start;
    try { start = await api("").connectStart(); } catch (e) { return say(e.message, true); }
    if (SAFE_URL.test(start.verification_url)) openUrl(start.verification_url);

    const current = { url: start.verification_url, code: start.user_code };
    current.promise = (async () => {
      try {
        const deadline = Date.now() + Math.min(start.expires_in || 600, 300) * 1000;
        const intervalMs = Math.max(start.interval ?? 3, 1) * 1000;
        while (Date.now() < deadline) {
          await sleep(intervalMs);
          let got;
          try { got = await api("").connectPoll(start.device_code); } catch { continue; }
          if (got.status === "approved") { await saveKey(got.api_key, env); return; }
          if (got.status === "denied" || got.status === "expired") return;
        }
      } catch { /* background sign-in failed silently: a fresh sign_in call starts a new attempt */ }
      finally { if (pending === current) pending = null; }
    })();
    pending = current;

    return say(`Open ${start.verification_url} and approve the connection (code ${start.user_code}). Then call get_credits to check.${envKeyActive(env) ? ENV_KEY_NOTE : ""}`);
  }

  return { removeBackground, getCredits, signIn };
}
