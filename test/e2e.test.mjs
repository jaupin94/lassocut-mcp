import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, copyFile, readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const key = process.env.LASSOCUT_E2E_KEY;

test("real preview through the MCP server", { skip: !key && "set LASSOCUT_E2E_KEY (robot key) to run" }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lc-e2e-"));
  const img = path.join(dir, "watch.jpg");
  await copyFile(path.join(import.meta.dirname, "fixtures", "watch.jpg"), img);
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(import.meta.dirname, "..", "src", "server.js")],
    env: { ...process.env, LASSOCUT_API_KEY: key, LASSOCUT_CONFIG: path.join(dir, "cfg.json") } }));
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, ["get_credits", "remove_background", "sign_in"]);
  const r = await client.callTool({ name: "remove_background", arguments: { images: img } });
  await client.close();
  assert.notEqual(r.isError, true);
  const out = await readFile(path.join(dir, "watch-no-bg.png"));
  assert.deepEqual([...out.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(r.content.filter((c) => c.type === "image").length, 1);
});
