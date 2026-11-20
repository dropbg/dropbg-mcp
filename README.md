# dropbg-mcp

Zero-dependency Model Context Protocol (MCP) `stdio` server for [DropBG](https://dropbg.io). Works with **Claude, DeepSeek, Qwen, Kimi, and GLM** across **Claude Desktop, Cursor, Claude Code, Trae, Cherry Studio, Windsurf, Cline, Roo Code, and Ollama** clients — removing backgrounds from local images or URLs and saving cutouts directly to disk without bloating context windows with base64 strings.

## Quick Setup (Zero API Key Required)

### Cursor, Claude Desktop, Trae, Cherry Studio, Windsurf, Cline & Roo Code

```json
{
  "mcpServers": {
    "dropbg": {
      "command": "npx",
      "args": ["-y", "dropbg-mcp"]
    }
  }
}
```

### Claude Code CLI

```bash
claude mcp add dropbg -- npx -y dropbg-mcp
```

## Available Tools

### 1. `remove_background_file`
Removes the background from a local image file and writes the result to disk.

- `input_path` (`string`, required): Local path to PNG, JPG, JPEG, or WEBP image.
- `output_path` (`string`, optional): Output file path (defaults to `<name>_cutout.png` or `.jpg` when using solid `bg_color`).
- `bg_color` (`string`, optional): 6-digit hex color (e.g. `#FFFFFF` for Amazon/passport photos). Omit for transparent PNG.
- `format` (`"auto" | "png" | "jpg" | "jpeg"`, optional, default `"auto"`).
- `size` (`"auto" | "preview" | "full" | "regular" | "medium" | "hd" | "4k"`, optional, default `"auto"`).
- `defringe` (`boolean`, optional, default `true`): Color decontamination along fine hair/fur edges.

### 2. `remove_background_url`
Removes the background from a public `http://` or `https://` image URL and saves it to a local path.

- `image_url` (`string`, required): Public image URL.
- `output_path` (`string`, required): Destination file path.
- `bg_color`, `format`, `size`, `defringe`: Same as above.

### 3. `remove_background_batch`
Sequentially removes backgrounds from up to 10 local image files and saves cutouts to disk or a target `output_dir`.

- `input_paths` (`string[]`, required): Local image paths (max 10).
- `output_dir` (`string`, optional): Destination directory.
- `bg_color`, `format`, `defringe`: Same as above.

## Testing

```bash
npm test --prefix apps/mcp
```
