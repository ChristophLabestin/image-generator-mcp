import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Keeping the API key out of ~/.claude.json: if the MCP client did not pass
 * OPENAI_API_KEY through the environment, fall back to a private key file.
 * Checked in order; the first one that yields a key wins.
 */
const KEY_FILES = [
  join(homedir(), ".config", "image-generator-mcp", ".env"),
  join(homedir(), ".config", "openai", ".env"),
];

export const KEY_FILE = KEY_FILES[0];

/** Minimal KEY=value parser - enough for a file we tell the user how to write. */
function parseEnv(text) {
  const out = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadKeyFiles() {
  for (const file of KEY_FILES) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const [k, v] of Object.entries(parseEnv(text))) {
      if (!process.env[k]) process.env[k] = v;
    }
  }
}
