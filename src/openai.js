import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { isDallE } from "./models.js";
import { loadKeyFiles, KEY_FILE } from "./config.js";

loadKeyFiles();

const API_BASE = process.env.OPENAI_BASE_URL?.replace(/\/+$/, "") || "https://api.openai.com/v1";

/** Thrown for any non-2xx from OpenAI. Carries enough for the caller to decide on a fallback. */
export class OpenAIError extends Error {
  constructor(status, body) {
    const err = body?.error || {};
    super(err.message || `OpenAI request failed with HTTP ${status}`);
    this.name = "OpenAIError";
    this.status = status;
    this.code = err.code || null;
    this.type = err.type || null;
    this.param = err.param || null;
  }

  /** True when the failure is "this key can't use this model", so trying a lesser model makes sense. */
  get isModelUnavailable() {
    if (this.status === 404 && (this.code === "model_not_found" || !this.code)) return true;
    if (this.status === 403 && /model|verif/i.test(this.message)) return true;
    return this.code === "model_not_found";
  }
}

function apiKey() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      `OPENAI_API_KEY is not set. Either write it to ${KEY_FILE} as ` +
        "OPENAI_API_KEY=sk-... , or pass it through the MCP server config."
    );
  }
  return key;
}

async function request(path, { method = "POST", json, form } = {}) {
  const headers = { Authorization: `Bearer ${apiKey()}` };
  let body;
  if (json) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form; // fetch sets the multipart boundary itself
  }

  const res = await fetch(`${API_BASE}${path}`, { method, headers, body });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    if (!res.ok) throw new OpenAIError(res.status, { error: { message: text.slice(0, 500) } });
    throw new Error(`OpenAI returned non-JSON response: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new OpenAIError(res.status, parsed);
  return parsed;
}

/**
 * Drop keys the target model does not understand, and translate the ones whose
 * vocabulary differs between the gpt-image-* family and dall-e-*.
 */
function normalizeParams(model, params) {
  const out = { model };
  const put = (k, v) => {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  };

  put("prompt", params.prompt);
  put("n", params.n);
  put("size", params.size);
  put("user", params.user);

  if (isDallE(model)) {
    // dall-e-3 speaks standard|hd, not low|medium|high, and returns urls unless told otherwise.
    const map = { low: "standard", medium: "standard", high: "hd", auto: undefined };
    put("quality", map[params.quality] ?? params.quality);
    put("style", params.style);
    out.response_format = "b64_json";
    if (model === "dall-e-3") out.n = 1;
  } else {
    put("quality", params.quality);
    put("background", params.background);
    put("output_format", params.output_format);
    put("output_compression", params.output_compression);
    put("moderation", params.moderation);
    put("input_fidelity", params.input_fidelity);
    // gpt-image-* always return b64_json; sending response_format is an error.
  }
  return out;
}

export async function generate(model, params) {
  return request("/images/generations", { json: normalizeParams(model, params) });
}

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

async function fileField(path) {
  const buf = await readFile(path);
  const ext = extname(path).toLowerCase();
  const type = MIME[ext];
  if (!type) {
    throw new Error(`Unsupported input image type "${ext || path}". Use .png, .jpg, or .webp.`);
  }
  return new File([buf], basename(path), { type });
}

export async function edit(model, params) {
  const flat = normalizeParams(model, params);
  const form = new FormData();
  for (const [k, v] of Object.entries(flat)) form.append(k, String(v));

  // The API takes repeated `image[]` fields when several reference images are given.
  const images = params.images;
  const field = images.length > 1 ? "image[]" : "image";
  for (const p of images) form.append(field, await fileField(p));
  if (params.mask) form.append("mask", await fileField(params.mask));

  return request("/images/edits", { form });
}

/** Model ids the current API key can actually see, image models first. */
export async function listAvailableModels() {
  const res = await request("/models", { method: "GET" });
  return (res.data || [])
    .map((m) => m.id)
    .filter((id) => /^(gpt-image|dall-e)/.test(id))
    .sort();
}
