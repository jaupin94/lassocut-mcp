#!/usr/bin/env node
// LassoCut MCP server (stdio): background removal for Claude Desktop, Claude Code, Cursor, Windsurf.
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { createHandlers } from "./tools.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// Created once for the life of the process (not per connection): sign-in state (the pending
// device-code poll) must survive and keep polling even if a client disconnects and reconnects.
const h = createHandlers({ version });

function createServer(h) {
  const server = new McpServer({ name: "lassocut", version });

  server.registerTool("remove_background", {
    description: "Remove the background of images with LassoCut. Accepts file paths, folders (their images, not subfolders) or http(s) URLs, up to 50 per call. Saves '<name>-no-bg.<ext>' next to each original (or in output_dir) and never overwrites. Uses size 'preview' (0.25 credit, 50 free a month, up to 10 a day) unless the user explicitly asks for full size.",
    inputSchema: z.object({
      images: z.union([z.string(), z.array(z.string())]).describe("File path, folder path or http(s) URL, or a list of them"),
      size: z.enum(["preview", "full"]).optional().describe("preview (default) or full (1 credit per image, only if the user asks)"),
      background: z.string().optional().describe("'transparent' (default), a hex color like '#ffffff', or a color name"),
      format: z.enum(["png", "jpg", "webp"]).optional().describe("Output format, png by default"),
      crop: z.boolean().optional().describe("Crop to the subject"),
      output_dir: z.string().optional().describe("absolute path; default: next to each original, or your Downloads folder for URLs"),
      confirm_cost: z.boolean().optional().describe("Set to true only after the user confirmed the full-size cost"),
    }),
  }, (args, extra) => h.removeBackground(args, extra));

  server.registerTool("get_credits", {
    description: "Show the LassoCut credit balance and the free previews available now (50 a month, up to 10 a day).",
    inputSchema: z.object({}),
  }, () => h.getCredits());

  server.registerTool("sign_in", {
    description: "Connect a LassoCut account: opens the LassoCut approval page in the browser and returns right away with the URL and code. Approval is saved automatically in the background (up to 5 minutes); call get_credits afterwards to check. Use force: true to switch accounts.",
    inputSchema: z.object({ force: z.boolean().optional() }),
  }, (args) => h.signIn(args));

  return server;
}

serveStdio(() => createServer(h));
