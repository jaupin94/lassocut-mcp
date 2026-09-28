// Where the LassoCut key comes from: LASSOCUT_API_KEY, else the file written by `lassocut login`
// (the same file, so the command-line tool and this connector share one sign-in).
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export const DEFAULT_API_URL = "https://api.lassocut.com/v1.0";

export function configPath(env = process.env, platform = process.platform) {
  if (env.LASSOCUT_CONFIG) return env.LASSOCUT_CONFIG;
  if (platform === "win32") {
    const base = env.APPDATA || path.win32.join(os.homedir(), "AppData", "Roaming");
    return path.win32.join(base, "lassocut", "config.json");
  }
  const base = env.XDG_CONFIG_HOME || path.posix.join(os.homedir(), ".config");
  return path.posix.join(base, "lassocut", "config.json");
}

// Claude Desktop passes "${user_config.api_key}" or "" when the optional key field is left empty.
function usable(value) {
  const v = typeof value === "string" ? value.trim() : "";
  return v && !v.startsWith("${") ? v : "";
}

export function findKey(env = process.env, platform = process.platform) {
  const fromEnv = usable(env.LASSOCUT_API_KEY);
  if (fromEnv) return fromEnv;
  try { return usable(JSON.parse(readFileSync(configPath(env, platform), "utf8")).api_key); } catch { return ""; }
}

export async function saveKey(key, env = process.env, platform = process.platform) {
  const file = configPath(env, platform);
  await mkdir(path.dirname(file), { recursive: true });
  let existing = {};
  try { existing = JSON.parse(await readFile(file, "utf8")); } catch { /* no config yet, or unreadable: start fresh */ }
  await writeFile(file, JSON.stringify({ ...existing, api_key: key }, null, 2), { mode: 0o600 });
  return file;
}

export function apiUrl(env = process.env) {
  return (usable(env.LASSOCUT_API_URL) || DEFAULT_API_URL).replace(/\/+$/, "");
}
