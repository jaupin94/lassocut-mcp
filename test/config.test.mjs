import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import { configPath, findKey, saveKey, apiUrl, DEFAULT_API_URL } from "../src/config.js";

test("configPath: Windows uses APPDATA", () => {
  assert.equal(configPath({ APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, "win32"),
    path.win32.join("C:\\Users\\a\\AppData\\Roaming", "lassocut", "config.json"));
});

test("configPath: Linux uses XDG_CONFIG_HOME", () => {
  assert.equal(configPath({ XDG_CONFIG_HOME: "/home/a/.cfg" }, "linux"), "/home/a/.cfg/lassocut/config.json");
});

test("configPath: LASSOCUT_CONFIG wins", () => {
  assert.equal(configPath({ LASSOCUT_CONFIG: "/tmp/x.json" }, "linux"), "/tmp/x.json");
});

test("findKey: env var first", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lc-"));
  const env = { LASSOCUT_CONFIG: path.join(dir, "c.json"), LASSOCUT_API_KEY: "envkey" };
  await saveKey("filekey", env);
  assert.equal(findKey(env), "envkey");
});

test("findKey: empty or unsubstituted env var is ignored", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lc-"));
  const env = { LASSOCUT_CONFIG: path.join(dir, "c.json") };
  await saveKey("filekey", env);
  assert.equal(findKey({ ...env, LASSOCUT_API_KEY: "" }), "filekey");
  assert.equal(findKey({ ...env, LASSOCUT_API_KEY: "  " }), "filekey");
  assert.equal(findKey({ ...env, LASSOCUT_API_KEY: "${user_config.api_key}" }), "filekey");
});

test("findKey: nothing configured gives empty string", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lc-"));
  assert.equal(findKey({ LASSOCUT_CONFIG: path.join(dir, "missing.json") }), "");
});

test("saveKey writes the same JSON shape as lassocut login", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lc-"));
  const env = { LASSOCUT_CONFIG: path.join(dir, "sub", "c.json") };
  const file = await saveKey("k1", env);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { api_key: "k1" });
});

test("apiUrl: default and override without trailing slash", () => {
  assert.equal(apiUrl({}), DEFAULT_API_URL);
  assert.equal(apiUrl({ LASSOCUT_API_URL: "http://localhost:9/v1.0/" }), "http://localhost:9/v1.0");
});
