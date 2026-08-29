#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { MODELS, FALLBACK_CHAIN, findModel, isDallE } from "./models.js";
import { generate, edit, listAvailableModels, OpenAIError } from "./openai.js";
import {
  resolveOutputDir,
  defaultOutputDir,
  expandHome,
  buildFilename,
  saveImage,
  makePreview,
} from "./output.js";

const server = new McpServer({ name: "image-generator", version: "1.0.0" });

/* ------------------------------------------------------------------ helpers */

const MODEL_ARG = z
  .string()
  .optional()
  .describe(
    'Image model id. Omit or pass "auto" to use the best available model ' +
      "(tries gpt-image-2, then falls back if this API key lacks access). " +
      "Pass an explicit id to control cost/quality: " +
      MODELS.map((m) => m.id).join(", ") +
      ". Any newer model id is also accepted and passed through unchanged."
  );

const SHARED_OUTPUT_ARGS = {
  output_dir: z
    .string()
    .optional()
    .describe(
      "Directory to write the images into. Pass an absolute path (e.g. the " +
        "current project's assets folder) when the images belong to a project. " +
        `Defaults to ${defaultOutputDir()}.`
    ),
  filename: z
    .string()
    .optional()
    .describe(
      "Base filename without extension. Defaults to a timestamp plus a slug of " +
        "the prompt. With n > 1 an index is appended."
    ),
  return_preview: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Return a downscaled copy of each image inline so you can actually look at " +
        "the result and iterate. Set false to save tokens when the image is not " +
        "going to be reviewed."
    ),
};

/** Run `fn` against the fallback chain when the caller did not pin a model. */
async function withModelFallback(requested, fn) {
  const pinned = requested && requested !== "auto";
  const chain = pinned ? [requested] : FALLBACK_CHAIN;
  const skipped = [];

  for (const model of chain) {
    try {
      return { model, result: await fn(model), skipped };
    } catch (err) {
      if (err instanceof OpenAIError && err.isModelUnavailable && !pinned) {
        skipped.push(`${model} (${err.message})`);
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `None of the fallback models are available to this API key. Tried:\n- ${skipped.join("\n- ")}`
  );
}

/** Turn an API response into saved files plus MCP content blocks. */
async function deliver(response, { model, prompt, output_dir, filename, return_preview, header }) {
  const dir = resolveOutputDir(output_dir);
  const images = response.data || [];
  if (!images.length) throw new Error("The API returned no images.");

  const ext = images[0].output_format || guessExt(images[0].b64_json);
  const content = [];
  const paths = [];

  for (const [i, img] of images.entries()) {
    if (!img.b64_json) {
      throw new Error("The API returned a URL instead of image data; cannot save the file.");
    }
    const buffer = Buffer.from(img.b64_json, "base64");
    const name = buildFilename({ filename, prompt, index: i, total: images.length, ext });
    const path = await saveImage(dir, name, buffer);
    paths.push({ path, bytes: buffer.length, revised_prompt: img.revised_prompt });

    if (return_preview !== false) {
      const preview = await makePreview(path, buffer);
      if (preview) content.push({ type: "image", data: preview.base64, mimeType: preview.mimeType });
    }
  }

  const lines = [header, `Model used: ${model}`];
  for (const p of paths) {
    lines.push(`Saved: ${p.path} (${(p.bytes / 1024).toFixed(0)} KB)`);
    if (p.revised_prompt) lines.push(`  Model-revised prompt: ${p.revised_prompt}`);
  }
  if (response.usage) {
    const u = response.usage;
    lines.push(
      `Tokens: ${u.total_tokens ?? "?"} total ` +
        `(input ${u.input_tokens ?? "?"}, output ${u.output_tokens ?? "?"})`
    );
  }
  content.unshift({ type: "text", text: lines.filter(Boolean).join("\n") });
  return { content };
}

function guessExt(b64) {
  if (!b64) return "png";
  const head = Buffer.from(b64.slice(0, 24), "base64");
  if (head[0] === 0xff && head[1] === 0xd8) return "jpg";
  if (head.slice(8, 12).toString() === "WEBP") return "webp";
  return "png";
}

function fail(err) {
  const detail =
    err instanceof OpenAIError
      ? `OpenAI error (HTTP ${err.status}${err.code ? `, ${err.code}` : ""}${
          err.param ? `, param: ${err.param}` : ""
        }): ${err.message}`
      : err.message;
  return { content: [{ type: "text", text: detail }], isError: true };
}

/* -------------------------------------------------------------------- tools */

server.registerTool(
  "generate_image",
  {
    title: "Generate an image",
    description:
      "Generate one or more images from a text prompt using OpenAI's GPT Image " +
      "models, save them to disk, and return the file paths plus an inline " +
      "preview.\n\n" +
      "Prompt style: these models follow long, specific prose well. Describe " +
      "subject, composition, lighting, medium/style, colour palette and mood. " +
      "Any text that should appear inside the image must be given verbatim in " +
      "quotes.\n\n" +
      "Cost control: use quality \"low\" (or gpt-image-1-mini) while iterating on " +
      "composition, then re-render the winner at quality \"high\".",
    inputSchema: {
      prompt: z
        .string()
        .min(1)
        .describe("What to draw. Be specific and descriptive; long prompts work well."),
      model: MODEL_ARG,
      size: z
        .string()
        .optional()
        .describe(
          'Image dimensions as "WIDTHxHEIGHT", or "auto". Common: 1024x1024 (square), ' +
            "1536x1024 (landscape), 1024x1536 (portrait). gpt-image-2 also accepts larger " +
            "sizes such as 2048x2048 and 3840x2160 (edges must be multiples of 16, " +
            "aspect ratio under 3:1)."
        ),
      quality: z
        .enum(["low", "medium", "high", "auto"])
        .optional()
        .describe(
          'Render quality. "low" is fast and cheap for drafts, "high" is for final ' +
            'output. Defaults to the model default ("auto").'
        ),
      background: z
        .enum(["transparent", "opaque", "auto"])
        .optional()
        .describe(
          'Use "transparent" for logos, icons, stickers and cut-outs. Requires ' +
            'output_format png or webp. Not supported by dall-e-3.'
        ),
      output_format: z
        .enum(["png", "jpeg", "webp"])
        .optional()
        .describe("File format. png (default) for graphics/transparency, jpeg/webp for photos."),
      output_compression: z
        .number()
        .int()
        .min(0)
        .max(100)
        .optional()
        .describe("Compression level 0-100 for jpeg/webp output."),
      moderation: z
        .enum(["low", "auto"])
        .optional()
        .describe('Content-filter strictness for gpt-image models. Defaults to "auto".'),
      style: z
        .enum(["vivid", "natural"])
        .optional()
        .describe("dall-e-3 only. Ignored by gpt-image models."),
      n: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("How many variations to generate. dall-e-3 supports only 1."),
      ...SHARED_OUTPUT_ARGS,
    },
  },
  async (args) => {
    try {
      const { model, result, skipped } = await withModelFallback(args.model, (m) =>
        generate(m, args)
      );
      return await deliver(result, {
        ...args,
        model,
        header: skipped.length
          ? `Generated ${result.data.length} image(s). Skipped unavailable: ${skipped.join("; ")}`
          : `Generated ${result.data.length} image(s).`,
      });
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "edit_image",
  {
    title: "Edit or extend an existing image",
    description:
      "Edit existing image(s) with a text instruction. Covers three jobs:\n" +
      "1. Whole-image edit - pass one image and describe the change.\n" +
      "2. Inpainting - pass a `mask` PNG whose transparent areas mark what to " +
      "replace; everything else is preserved.\n" +
      "3. Composition / style reference - pass several images and describe how to " +
      "combine them (e.g. put the product from image 1 into the scene from image 2).\n\n" +
      "Input images must be png, jpg or webp. dall-e-3 cannot edit; use a gpt-image model.",
    inputSchema: {
      prompt: z
        .string()
        .min(1)
        .describe("The edit instruction, or a description of the desired final image."),
      images: z
        .array(z.string())
        .min(1)
        .max(16)
        .describe(
          "Absolute paths to the input image(s). With more than one, they are treated " +
            "as references to combine."
        ),
      mask: z
        .string()
        .optional()
        .describe(
          "Absolute path to a PNG mask with an alpha channel. Transparent pixels are " +
            "the region the model may repaint; opaque pixels are kept. Must match the " +
            "first input image's dimensions."
        ),
      model: MODEL_ARG,
      size: z.string().optional().describe('Output dimensions as "WIDTHxHEIGHT", or "auto".'),
      quality: z.enum(["low", "medium", "high", "auto"]).optional().describe("Render quality."),
      background: z.enum(["transparent", "opaque", "auto"]).optional(),
      output_format: z.enum(["png", "jpeg", "webp"]).optional(),
      output_compression: z.number().int().min(0).max(100).optional(),
      input_fidelity: z
        .enum(["low", "high"])
        .optional()
        .describe(
          'Use "high" to preserve faces, logos and fine detail from the input. ' +
            "Not configurable on gpt-image-2, which is always high fidelity."
        ),
      n: z.number().int().min(1).max(10).optional(),
      ...SHARED_OUTPUT_ARGS,
    },
  },
  async (args) => {
    try {
      const images = args.images.map(expandHome);
      const mask = args.mask ? expandHome(args.mask) : undefined;
      const { model, result, skipped } = await withModelFallback(args.model, (m) =>
        edit(m, { ...args, images, mask })
      );
      return await deliver(result, {
        ...args,
        model,
        header: skipped.length
          ? `Edited image(s). Skipped unavailable: ${skipped.join("; ")}`
          : `Edited ${result.data.length} image(s).`,
      });
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "list_image_models",
  {
    title: "List available image models",
    description:
      "Show the image models this API key can use, with guidance on which to pick. " +
      "Call this when you are unsure whether a model is available, when a " +
      "generation failed with a model error, or when the user asks what is possible.",
    inputSchema: {},
  },
  async () => {
    const lines = ["# Image models\n"];
    let live = null;
    try {
      live = await listAvailableModels();
    } catch (err) {
      lines.push(`(Could not query the live model list: ${err.message})\n`);
    }

    for (const m of MODELS) {
      const status = live ? (live.some((id) => id.startsWith(m.id)) ? "available" : "NOT available to this key") : "unknown";
      lines.push(`## ${m.id}  [${m.tier}] - ${status}`);
      lines.push(`Best for: ${m.bestFor}`);
      lines.push(`Sizes: ${m.sizes}`);
      lines.push(`Quality: ${m.quality.join(", ")}`);
      lines.push(`Supports: ${m.supports.join(", ")}`);
      if (m.notes) lines.push(`Note: ${m.notes}`);
      lines.push("");
    }

    if (live) {
      const extras = live.filter((id) => !findModel(id));
      if (extras.length) {
        lines.push(`Other image models visible to this key (pass the id through directly): ${extras.join(", ")}`);
      }
    }
    lines.push(`\nDefault output directory: ${defaultOutputDir()}`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

/* --------------------------------------------------------------------- boot */

await server.connect(new StdioServerTransport());
