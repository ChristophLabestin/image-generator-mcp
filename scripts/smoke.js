#!/usr/bin/env node
/**
 * Speaks the MCP stdio handshake to src/index.js and prints what the server
 * advertises. Runs without an API key: `tools/list` needs no OpenAI call.
 * With OPENAI_API_KEY set it also calls list_image_models for a live check.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn("node", [join(root, "src", "index.js")], {
  stdio: ["pipe", "pipe", "inherit"],
});

let buf = "";
const pending = new Map();
child.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
  }
});

let id = 0;
const send = (method, params) =>
  new Promise((res) => {
    const rpcId = ++id;
    pending.set(rpcId, res);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }) + "\n");
  });
const notify = (method, params) =>
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");

const init = await send("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});
console.log("initialize ->", init.result.serverInfo, init.result.protocolVersion);
notify("notifications/initialized");

const tools = await send("tools/list", {});
console.log("\ntools:");
for (const t of tools.result.tools) {
  console.log(` - ${t.name}: ${Object.keys(t.inputSchema.properties || {}).join(", ") || "(no args)"}`);
}

const r = await send("tools/call", { name: "list_image_models", arguments: {} });
const text = r.result.content[0].text;
console.log("\nlist_image_models ->\n" + text.split("\n").slice(0, 40).join("\n"));

child.kill();
