import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir, tmpdir } from "node:os";
import { join, isAbsolute, resolve } from "node:path";

const run = promisify(execFile);

/** Longest edge of the inline preview handed back to Claude, in pixels. */
const PREVIEW_EDGE = 768;
/** Above this, an un-resizable image is described rather than inlined. */
const RAW_INLINE_LIMIT = 900 * 1024;

export function defaultOutputDir() {
  return process.env.IMAGE_OUTPUT_DIR
    ? expandHome(process.env.IMAGE_OUTPUT_DIR)
    : join(homedir(), "Pictures", "claude-images");
}

export function expandHome(p) {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

export function resolveOutputDir(requested) {
  if (!requested) return defaultOutputDir();
  const p = expandHome(requested);
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

function slug(text) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "image"
  );
}

function stamp() {
  // Local time, filesystem-safe: 20260829-142530
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** Only strip a real image extension - a caller-supplied "logo-v1.5" must keep its ".5". */
const EXT_RE = /\.(png|jpe?g|webp)$/i;

export function buildFilename({ filename, prompt, index, total, ext }) {
  const base = filename ? filename.replace(EXT_RE, "") : `${stamp()}-${slug(prompt)}`;
  const suffix = total > 1 ? `-${index + 1}` : "";
  return `${base}${suffix}.${ext}`;
}

export async function saveImage(dir, name, buffer) {
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, buffer);
  return path;
}

/** True when a PNG buffer carries an alpha channel (IHDR colour type 4 or 6). */
function hasAlpha(buffer) {
  const isPng =
    buffer.length > 26 &&
    buffer[0] === 0x89 &&
    buffer.toString("latin1", 1, 4) === "PNG" &&
    buffer.toString("latin1", 12, 16) === "IHDR";
  return isPng && (buffer[25] === 4 || buffer[25] === 6);
}

/**
 * Produce a small image the model can actually look at without blowing up the
 * context. Uses macOS `sips`; elsewhere it falls back to inlining the original
 * when it is small enough, and to no preview at all when it is not.
 *
 * Transparent images must stay PNG: a JPEG preview flattens alpha to white,
 * which reads as "the transparent background did not work" and provokes a
 * pointless re-render. Everything else goes to JPEG, which is far smaller.
 */
export async function makePreview(path, buffer) {
  const alpha = hasAlpha(buffer);
  const ext = alpha ? "png" : "jpg";
  const out = join(tmpdir(), `mcp-img-preview-${process.pid}-${Math.random().toString(36).slice(2)}.${ext}`);
  try {
    await run("sips", [
      "-Z", String(PREVIEW_EDGE),
      "-s", "format", alpha ? "png" : "jpeg",
      ...(alpha ? [] : ["-s", "formatOptions", "70"]),
      path,
      "--out", out,
    ]);
    const data = await readFile(out);
    return {
      mimeType: alpha ? "image/png" : "image/jpeg",
      base64: data.toString("base64"),
    };
  } catch {
    if (buffer.length <= RAW_INLINE_LIMIT) {
      return { mimeType: "image/png", base64: buffer.toString("base64") };
    }
    return null;
  } finally {
    await rm(out, { force: true }).catch(() => {});
  }
}
