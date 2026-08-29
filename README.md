# image-generator-mcp

An MCP server that lets **Claude generate and edit images with OpenAI's GPT
Image models**, plus a Claude skill that teaches Claude *when* and *how* to use
it — which model to pick, how to prompt these models, and where to put the files.

Works with Claude Code, and with any other MCP client that speaks stdio.

## What Claude gets

| Tool | Does |
|---|---|
| `generate_image` | Text prompt → one or more images, saved to disk, previewed inline |
| `edit_image` | Whole-image edits, inpainting with a mask, multi-image composition |
| `list_image_models` | Which image models your API key can actually use, and what each is good for |

**Claude picks the model itself.** Left on `auto`, the server tries
`gpt-image-2` and walks down `gpt-image-1.5 → gpt-image-1 → gpt-image-1-mini` if
your key lacks access, reporting which ones it skipped. Any model id is accepted
and passed straight through, so models released after this was written keep
working without a code change.

## Requirements

- Node.js ≥ 20 (uses built-in `fetch`, `FormData` and `File`)
- An OpenAI API key with access to the image models
- macOS gets downscaled inline previews via the built-in `sips`; other platforms
  still save every file correctly (see [Previews](#previews))

## Setup

### 1. Clone and install

```bash
git clone https://github.com/ChristophLabestin/image-generator-mcp.git
cd image-generator-mcp
npm install
```

### 2. Store your OpenAI API key

The server reads the key from a private file, so it never has to be written into
an MCP client config that might get synced or shared:

```bash
mkdir -p ~/.config/image-generator-mcp
printf 'OPENAI_API_KEY=sk-YOUR-KEY-HERE\n' > ~/.config/image-generator-mcp/.env
chmod 600 ~/.config/image-generator-mcp/.env
```

A plain `OPENAI_API_KEY` in the environment also works and takes precedence.

**Restricted-key permissions.** If you scope the key rather than granting full
access, it needs exactly two: `Images → Write` (generation and edits) and
`Models → Read` (for `list_image_models`). Everything else can stay `None`.
Without `Models → Read` the image tools still work; only the live model listing
fails.

### 3. Register the server with Claude Code

From inside the cloned directory, so `$PWD` resolves to it:

```bash
claude mcp add image-generator --scope user -- node "$PWD/src/index.js"
```

`--scope user` makes it available in **every** project. Use `--scope project`
instead to limit it to one repo.

Verify:

```bash
claude mcp list
```

Then **restart Claude Code** — a server registered mid-session is not loaded
into that session.

<details>
<summary>Other MCP clients</summary>

Any stdio MCP client works. The equivalent JSON config entry:

```json
{
  "mcpServers": {
    "image-generator": {
      "command": "node",
      "args": ["/absolute/path/to/image-generator-mcp/src/index.js"]
    }
  }
}
```

</details>

### 4. Install the skill

The MCP server alone lets Claude generate images. The skill is what makes it
*choose well* — model selection, prompt craft, the cheap-draft-then-final
workflow, and saving into the project's own asset folder. Install it at user
scope so it applies across all projects:

```bash
mkdir -p ~/.claude/skills
cp -r skills/image-generation ~/.claude/skills/
```

Claude loads it automatically when a request involves images; you do not invoke
it by hand.

### 5. Check it works

```bash
npm run smoke
```

This speaks the MCP handshake to the server and prints the advertised tools.
With the key in place it also lists the models your key can reach. It makes no
image-generation calls, so it costs nothing.

## Usage

Just ask in plain language — "make me an icon for X with a transparent
background", "change the background in this photo to a beach". Claude selects
the tool, the model and the parameters.

## Where images land

Resolution order, first match wins:

1. `output_dir` passed on the individual tool call — absolute, or relative to
   the server's working directory
2. The `IMAGE_OUTPUT_DIR` environment variable
3. `~/Pictures/claude-images`

The skill instructs Claude to use option 1 with the project's own asset
directory for anything project-related, so generated images land in the repo
rather than in your Pictures folder. `IMAGE_OUTPUT_DIR` is the right lever only
if you want a different global default.

## Configuration

| Env var | Effect |
|---|---|
| `OPENAI_API_KEY` | Required. Falls back to `~/.config/image-generator-mcp/.env`. |
| `IMAGE_OUTPUT_DIR` | Default save directory. Defaults to `~/Pictures/claude-images`. |
| `OPENAI_BASE_URL` | Point at a proxy or compatible endpoint. Defaults to `https://api.openai.com/v1`. |

## Model guidance

| Situation | Model |
|---|---|
| Final artwork, text inside the image, 2K/4K, inpainting | `gpt-image-2` |
| Many images, quality still matters, no 4K needed | `gpt-image-1.5` |
| Cheap drafts, thumbnails, composition roughs | `gpt-image-1-mini` |
| Explicitly asked for DALL·E 3 | `dall-e-3` |

Generation is billed per image and `quality: "high"` costs several times
`"low"`, so the skill has Claude draft cheap, confirm the composition with you,
and only then render the final.

## Verified behaviour

Checked end to end against the live API rather than read off the docs:

- Generation, the multipart edit upload, and the error path all behave.
- `background: "transparent"` produces a genuine RGBA alpha channel (corner
  pixels at alpha 0) on **gpt-image-2, gpt-image-1.5, gpt-image-1 and
  gpt-image-1-mini** — verified by decoding the PNG alpha channel pixel by
  pixel. Drafting transparent assets on the cheap model is therefore a valid
  workflow. `dall-e-3` has no transparency.

## Previews

Every image is written to disk. What Claude gets back inline is a *downscaled*
JPEG (768px max edge) so a 4K render does not flood the context window. That
resize uses macOS `sips`; on other platforms the original is inlined when it is
small enough and skipped when it is not. **The saved file is always the full
original either way** — only the preview is affected.

## Notes

- `dall-e-3` speaks a different parameter vocabulary (`quality: standard|hd`,
  `style`, `n` forced to 1). The server translates automatically.
- OpenAI errors come back verbatim with status code and parameter name, so
  Claude can correct its own call instead of guessing.
- No API key is ever stored in the repository or in your MCP client config.

## Layout

```
src/index.js          MCP server: tool definitions, model fallback, result delivery
src/openai.js         OpenAI /v1/images client (generations, edits, models)
src/models.js         Curated model catalog + fallback chain
src/output.js         Filename building, saving, preview downscaling
src/config.js         API key file loading
scripts/smoke.js      MCP handshake test
skills/image-generation/SKILL.md   The Claude skill
```

## License

MIT — see [LICENSE](LICENSE).
