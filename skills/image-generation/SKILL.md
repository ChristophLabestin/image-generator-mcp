---
name: image-generation
description: Generate, edit, inpaint, or restyle images with OpenAI's GPT Image models via the image-generator MCP server. Use whenever the user asks for an image, picture, illustration, logo, icon, mockup visual, hero graphic, thumbnail, texture, product shot, avatar, or asks to change/extend/upscale/remove something from an existing image. Also use when a task needs placeholder or asset imagery for a project.
---

# Image generation with GPT Image

Images are produced by the `image-generator` MCP server, which wraps OpenAI's
`/v1/images` endpoints. Three tools: `generate_image`, `edit_image`,
`list_image_models`.

## Choosing a model

Leave `model` unset (or `"auto"`) unless you have a reason not to — the server
starts at `gpt-image-2` and falls back automatically if the key lacks access.

Override when cost or character matters:

| Situation | Model |
|---|---|
| Final artwork, text inside the image, 2K/4K, inpainting | `gpt-image-2` |
| Lots of images, quality still matters, no 4K needed | `gpt-image-1.5` |
| Cheap drafts, thumbnails, composition roughs | `gpt-image-1-mini` |
| User explicitly asks for DALL·E 3 | `dall-e-3` |

If a call fails with a model error, run `list_image_models` — it reports which
models this API key can actually see — and retry with an available one.

## The two-pass workflow

Generation is billed per image and high quality is several times the price of
low. For anything non-trivial:

1. **Draft** — `quality: "low"`, small size. Show the user, confirm the
   composition is right.
2. **Final** — same prompt, `quality: "high"`, the real size.

Skip the draft pass only for one-off throwaway images or when the user is
clearly in a hurry.

## Writing the prompt

These models reward long, concrete prose over keyword soup. Cover:

- **Subject** — what it is, in detail.
- **Composition** — framing, camera angle, what's in fore/background.
- **Style/medium** — photograph, 3D render, flat vector, watercolour, and so on.
  Name a lens and lighting for photographs.
- **Palette and mood.**
- **Text** — any words that must appear go in the prompt **verbatim, in quotes**.
  Say where they sit. Keep it short; long strings still come out garbled.
- **Negatives** — state them positively where you can ("an empty desk" beats
  "no clutter").

Do not silently rewrite what the user asked for. Add craft detail, keep intent.

## Sizes and format

- `1024x1024` square, `1536x1024` landscape, `1024x1536` portrait — the safe set
  for every model.
- `gpt-image-2` additionally takes arbitrary sizes: both edges multiples of 16,
  max edge 3840, aspect ratio under 3:1. Use it for `1920x1080`, `2048x2048`,
  `3840x2160`.
- `background: "transparent"` with `output_format: "png"` (or `webp`) for logos,
  icons, stickers and anything that gets composited. **Every gpt-image model
  supports this** — `gpt-image-2`, `1.5`, `1` and `1-mini` were all verified to
  return a real alpha channel with fully transparent corners. So you can draft
  transparent assets cheaply on `gpt-image-1-mini` and only go up for the final.
  `dall-e-3` cannot do transparency at all.
- `output_format: "jpeg"` for photographic images headed for the web.

## Where files go

`output_dir` defaults to `~/Pictures/claude-images`. **When the image belongs to
a project, pass the project's own asset directory as an absolute path** — e.g.
`<project>/public/images`, `<project>/src/assets`, `<project>/static/img`.

Look at what the repo already does before inventing a folder: check for an
existing assets directory, and how images are referenced in the code. A
generated image that the build cannot find is worthless. Pass `filename` too
whenever code will reference the image by name — otherwise it gets a timestamped
slug that nobody wants in a source file.

The default only applies when you pass nothing, so pass something on almost
every project task.

## Editing existing images

`edit_image` covers three jobs:

- **Whole-image edit** — one input image plus an instruction ("make it winter").
- **Inpainting** — add a `mask`: a PNG with an alpha channel, same dimensions as
  the input, where **transparent pixels mark the area the model may repaint**
  and opaque pixels are preserved. If you need to build a mask, write a small
  Python/Pillow or ImageMagick script; macOS `sips` cannot author alpha masks.
- **Reference composition** — several input images plus a description of how to
  combine them ("place the bottle from image 1 on the table in image 2").

Use `input_fidelity: "high"` when faces, logos or fine detail must survive the
edit. `gpt-image-2` ignores it — it is always high fidelity.

## After generating

Each call returns the saved path plus a downscaled inline preview. **Look at the
preview.** If it misses the brief, say what is wrong and iterate on the prompt
rather than handing the user something you can see is off. Set
`return_preview: false` only for bulk generation you are not going to review.

Report the file path to the user. Never claim an image is "generated" until a
tool call has returned a path.

## Content limits

The API refuses sexual content, graphic violence, and images of real public
figures. Real-person likenesses and trademarked characters will often be
rejected. If a generation is refused on content grounds, relay that plainly and
offer a reframing — do not try to slip the same request past the filter with
euphemisms.
