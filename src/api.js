// HTTP calls to the LassoCut API (compatible with the remove.bg API), with retries and readable errors.
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const BUSY = "LassoCut servers are busy, please retry in a minute.";
const OFFLINE = "Could not reach LassoCut, check the connection.";
const RETRY = new Set([502, 503, 504]);
const ATTEMPTS = 3;

async function errorFor(res) {
  let first = null;
  try { first = (await res.json()).errors?.[0] || null; } catch { /* HTML or empty body */ }
  switch (res.status) {
    case 402: return "Not enough credits. Buy a pack at https://www.lassocut.com/account/ or use size: preview.";
    case 403: return "The LassoCut key was rejected. Call sign_in with force: true.";
    case 429: return `Rate limit reached, retry in ${Number(res.headers.get("retry-after")) || 60} seconds.`;
  }
  if (first?.code === "unknown_foreground") return "No clear subject found in this image.";
  if (first?.title) return first.title + (first.detail ? `: ${first.detail}` : "");
  return res.status >= 500 ? BUSY : `LassoCut returned HTTP ${res.status}.`;
}

export function createApi({ apiUrl, apiKey, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), version = "1.0.0" }) {
  const base = { "X-Lassocut-Client": "mcp", "User-Agent": `lassocut-mcp/${version}` };
  const withKey = () => ({ ...base, "X-Api-Key": apiKey });

  async function send(path, init) {
    for (let attempt = 1; ; attempt++) {
      let res;
      try { res = await fetchImpl(`${apiUrl}${path}`, init()); } catch { throw new ApiError(0, OFFLINE); }
      if (RETRY.has(res.status) && attempt < ATTEMPTS) { await sleep(1000 * attempt); continue; }
      if (RETRY.has(res.status)) throw new ApiError(res.status, BUSY);
      if (!res.ok) throw new ApiError(res.status, await errorFor(res));
      return res;
    }
  }

  const postJson = (path, data) => send(path, () => ({ method: "POST", headers: { ...base, "Content-Type": "application/json" }, body: JSON.stringify(data) })).then((r) => r.json());

  return {
    async removeBackground({ file, url, fields, idempotencyKey }) {
      const res = await send("/removebg", () => {
        const form = new FormData();
        if (file) form.append("image_file", new Blob([file.bytes]), file.name);
        else form.append("image_url", url);
        for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
        return { method: "POST", body: form, headers: { ...withKey(), "Idempotency-Key": idempotencyKey } };
      });
      return { bytes: Buffer.from(await res.arrayBuffer()), credits: Number(res.headers.get("x-credits-charged") || 0), contentType: res.headers.get("content-type") || "" };
    },
    async account() {
      const a = (await (await send("/account", () => ({ headers: withKey() }))).json()).data.attributes;
      return { credits: Number(a.credits.total), freePreviews: Number(a.api.free_calls) };
    },
    connectStart: () => postJson("/connect/start", { client: "mcp" }),
    connectPoll: (deviceCode) => postJson("/connect/poll", { device_code: deviceCode }),
  };
}
