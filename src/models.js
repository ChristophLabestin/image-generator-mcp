/**
 * Curated catalog of OpenAI image models.
 *
 * This is guidance, not a gate: `generate_image` / `edit_image` accept any model
 * id string and pass it straight through to the API, so a model released after
 * this file was written still works. The catalog exists so Claude can pick a
 * sensible model without a round-trip, and so `list_image_models` can explain
 * the trade-offs.
 */

export const MODELS = [
  {
    id: "gpt-image-2",
    tier: "flagship",
    bestFor:
      "Default choice. Highest fidelity, best text rendering inside images, " +
      "flexible resolutions up to 4K, inpainting via mask, transparent backgrounds.",
    sizes:
      "Flexible: both edges multiples of 16, max edge 3840px, aspect ratio under 3:1, " +
      "655360-8294400 total pixels. Common: 1024x1024, 1536x1024, 1024x1536, 2048x2048, 3840x2160.",
    quality: ["low", "medium", "high", "auto"],
    supports: ["generate", "edit", "mask", "transparent", "multi-image-reference"],
    notes:
      "input_fidelity is not configurable - every input image is processed at high fidelity. " +
      "background:transparent verified working (real alpha channel, corner pixels at alpha 0).",
  },
  {
    id: "gpt-image-1.5",
    tier: "flagship-previous",
    bestFor:
      "Very close to gpt-image-2 in quality at lower cost. Good default when " +
      "generating many images or when 4K is not needed.",
    sizes: "1024x1024, 1536x1024 (landscape), 1024x1536 (portrait), auto",
    quality: ["low", "medium", "high", "auto"],
    supports: ["generate", "edit", "mask", "transparent", "input_fidelity"],
    notes: "background:transparent verified working (real alpha channel).",
  },
  {
    id: "gpt-image-1",
    tier: "standard",
    bestFor:
      "Previous generation. Use when you want the older, well-known gpt-image-1 " +
      "look, or for compatibility with existing prompt libraries.",
    sizes: "1024x1024, 1536x1024, 1024x1536, auto",
    quality: ["low", "medium", "high", "auto"],
    supports: ["generate", "edit", "mask", "transparent", "input_fidelity"],
    notes: "background:transparent verified working (real alpha channel).",
  },
  {
    id: "gpt-image-1-mini",
    tier: "cheap",
    bestFor:
      "Fast, cheap drafts: thumbnails, layout roughs, iterating on composition " +
      "before committing to an expensive render.",
    sizes: "1024x1024, 1536x1024, 1024x1536, auto",
    quality: ["low", "medium", "high", "auto"],
    supports: ["generate", "edit", "mask", "transparent"],
    notes:
      "background:transparent verified working (real alpha channel). " +
      "Scheduled for API removal on 2026-12-01; gpt-image-2 is the replacement.",
  },
  {
    id: "dall-e-3",
    tier: "legacy",
    bestFor:
      "Legacy. Only use when the user explicitly asks for DALL-E 3, e.g. to " +
      "reproduce an older image. Cannot edit, no transparency.",
    sizes: "1024x1024, 1792x1024, 1024x1792",
    quality: ["standard", "hd"],
    supports: ["generate", "style"],
    notes:
      "Uses quality standard|hd (not low/medium/high), supports style vivid|natural, " +
      "n must be 1, and returns a url by default - this server forces b64_json.",
  },
];

/** Tried in order when model is "auto" or when a model turns out to be unavailable. */
export const FALLBACK_CHAIN = [
  "gpt-image-2",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
];

export function findModel(id) {
  return MODELS.find((m) => m.id === id || id.startsWith(m.id + "-"));
}

/** dall-e-* take a different parameter vocabulary than the gpt-image-* family. */
export function isDallE(model) {
  return model.startsWith("dall-e");
}
