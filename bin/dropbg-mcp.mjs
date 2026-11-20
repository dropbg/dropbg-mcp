#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const API_URL = process.env.DROPBG_API_URL || 'https://api.dropbg.io/v1.0/removebg';
const PROTOCOL_VERSION = '2024-11-05';
const MAX_BATCH_FILES = 10;

const SERVER_INFO = {
  name: 'dropbg-mcp',
  version: '1.0.2',
};

const TOOLS = [
  {
    name: 'remove_background_file',
    description:
      'Remove the background from a local image file (PNG, JPG, JPEG, WEBP) using DropBG and save the transparent PNG or solid-color cutout to disk.',
    inputSchema: {
      type: 'object',
      properties: {
        input_path: {
          type: 'string',
          description: 'Path to the local source image file.',
        },
        output_path: {
          type: 'string',
          description:
            'Path to save the processed image. Defaults to <dir>/<name>_cutout.png (or .jpg when format is jpg/jpeg or bg_color is set with format "auto").',
        },
        bg_color: {
          type: 'string',
          description:
            'Optional 6-digit hex color (e.g. #FFFFFF for Amazon/passport white backgrounds). Omit for transparent cutout.',
        },
        format: {
          type: 'string',
          enum: ['auto', 'png', 'jpg', 'jpeg'],
          default: 'auto',
          description: 'Output image format.',
        },
        size: {
          type: 'string',
          enum: ['auto', 'preview', 'full', 'regular', 'medium', 'hd', '4k'],
          default: 'auto',
          description: 'Output resolution preset.',
        },
        defringe: {
          type: 'boolean',
          default: true,
          description: 'Apply color decontamination on hair/fur edges.',
        },
      },
      required: ['input_path'],
    },
  },
  {
    name: 'remove_background_url',
    description:
      'Remove the background from a public HTTP/HTTPS image URL using DropBG and save the result to a local file path.',
    inputSchema: {
      type: 'object',
      properties: {
        image_url: {
          type: 'string',
          description: 'Public http:// or https:// URL of the source image.',
        },
        output_path: {
          type: 'string',
          description: 'Local destination path to save the processed cutout image.',
        },
        bg_color: {
          type: 'string',
          description: 'Optional 6-digit hex background color (e.g. #FFFFFF).',
        },
        format: {
          type: 'string',
          enum: ['auto', 'png', 'jpg', 'jpeg'],
          default: 'auto',
          description: 'Output image format.',
        },
        size: {
          type: 'string',
          enum: ['auto', 'preview', 'full', 'regular', 'medium', 'hd', '4k'],
          default: 'auto',
          description: 'Output resolution preset.',
        },
        defringe: {
          type: 'boolean',
          default: true,
          description: 'Apply color decontamination on hair/fur edges.',
        },
      },
      required: ['image_url', 'output_path'],
    },
  },
  {
    name: 'remove_background_batch',
    description:
      'Remove backgrounds from multiple local image files sequentially (up to 10 files per batch) and save the cutouts to disk.',
    inputSchema: {
      type: 'object',
      properties: {
        input_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of local image file paths (max 10).',
        },
        output_dir: {
          type: 'string',
          description: "Optional directory to write all processed cutouts into. Defaults to each input file's directory.",
        },
        bg_color: {
          type: 'string',
          description: 'Optional 6-digit hex background color (e.g. #FFFFFF).',
        },
        format: {
          type: 'string',
          enum: ['auto', 'png', 'jpg', 'jpeg'],
          default: 'auto',
          description: 'Output image format.',
        },
        defringe: {
          type: 'boolean',
          default: true,
          description: 'Apply color decontamination on hair/fur edges.',
        },
      },
      required: ['input_paths'],
    },
  },
];

function inferMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

function resolveDefaultOutputExt({ format = 'auto', bg_color }) {
  const normalizedFormat = String(format).toLowerCase();
  if (normalizedFormat === 'jpg' || normalizedFormat === 'jpeg') return 'jpg';
  if (normalizedFormat === 'auto' && bg_color) return 'jpg';
  return 'png';
}

function resolveOutputPath(inputPath, outputPath, options) {
  if (outputPath) {
    return path.resolve(outputPath);
  }
  const parsed = path.parse(path.resolve(inputPath));
  const ext = resolveDefaultOutputExt(options);
  return path.join(parsed.dir, `${parsed.name}_cutout.${ext}`);
}

function appendCommonFormFields(formData, { size = 'auto', format = 'auto', bg_color, defringe = true }) {
  formData.append('size', String(size));
  formData.append('format', String(format));
  formData.append('defringe', String(defringe));
  if (bg_color) {
    formData.append('bg_color', String(bg_color));
  }
}

function parseIntHeader(headers, name) {
  const raw = headers.get(name);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function parseErrorResponse(response) {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed?.errors) && parsed.errors[0]?.detail) {
      return `HTTP ${response.status}: ${parsed.errors[0].detail}`;
    }
    if (parsed?.detail) {
      return `HTTP ${response.status}: ${parsed.detail}`;
    }
  } catch {
    // Non-JSON response body
  }
  return `HTTP ${response.status}: ${text || response.statusText}`;
}

async function callRemoveBgApi(formData, destinationPath) {
  const response = await fetch(API_URL, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await parseErrorResponse(response));
  }

  const resolvedOutput = path.resolve(destinationPath);
  const arrayBuffer = await response.arrayBuffer();
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  await fs.writeFile(resolvedOutput, Buffer.from(arrayBuffer));

  return {
    output_path: resolvedOutput,
    content_type: response.headers.get('content-type') || 'image/png',
    bytes: arrayBuffer.byteLength,
    width: parseIntHeader(response.headers, 'x-width'),
    height: parseIntHeader(response.headers, 'x-height'),
    processing_time_ms: parseIntHeader(response.headers, 'x-processing-time-ms'),
    quota_remaining: parseIntHeader(response.headers, 'x-ratelimit-remaining'),
    quota_reset_seconds: parseIntHeader(response.headers, 'x-ratelimit-reset'),
  };
}

async function handleRemoveBackgroundFile(args) {
  if (!args || typeof args.input_path !== 'string' || !args.input_path.trim()) {
    throw new Error("Missing required parameter 'input_path'.");
  }

  const resolvedInput = path.resolve(args.input_path);
  const fileBuffer = await fs.readFile(resolvedInput);
  const mimeType = inferMimeType(resolvedInput);
  const blob = new Blob([fileBuffer], { type: mimeType });

  const formData = new FormData();
  formData.append('image_file', blob, path.basename(resolvedInput));
  appendCommonFormFields(formData, args);

  const destinationPath = resolveOutputPath(resolvedInput, args.output_path, args);
  return callRemoveBgApi(formData, destinationPath);
}

async function handleRemoveBackgroundUrl(args) {
  if (!args || typeof args.image_url !== 'string' || !args.image_url.trim()) {
    throw new Error("Missing required parameter 'image_url'.");
  }
  if (typeof args.output_path !== 'string' || !args.output_path.trim()) {
    throw new Error("Missing required parameter 'output_path'.");
  }

  const url = new URL(args.image_url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error("'image_url' must use http:// or https://.");
  }

  const formData = new FormData();
  formData.append('image_url', url.toString());
  appendCommonFormFields(formData, args);

  return callRemoveBgApi(formData, args.output_path);
}

async function handleRemoveBackgroundBatch(args) {
  if (!args || !Array.isArray(args.input_paths) || args.input_paths.length === 0) {
    throw new Error("Missing required non-empty array parameter 'input_paths'.");
  }
  if (args.input_paths.length > MAX_BATCH_FILES) {
    throw new Error(`Batch size exceeds maximum of ${MAX_BATCH_FILES} files.`);
  }

  const results = [];
  const ext = resolveDefaultOutputExt(args);
  const resolvedOutDir = args.output_dir ? path.resolve(args.output_dir) : null;

  for (const inputPath of args.input_paths) {
    if (typeof inputPath !== 'string' || !inputPath.trim()) {
      results.push({ input_path: inputPath, ok: false, error: 'Invalid input path entry.' });
      continue;
    }
    const parsed = path.parse(path.resolve(inputPath));
    const targetDir = resolvedOutDir || parsed.dir;
    const outputPath = path.join(targetDir, `${parsed.name}_cutout.${ext}`);
    try {
      const processed = await handleRemoveBackgroundFile({
        ...args,
        input_path: inputPath,
        output_path: outputPath,
      });
      results.push({ input_path: path.resolve(inputPath), ok: true, ...processed });
    } catch (error) {
      results.push({
        input_path: path.resolve(inputPath),
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    total: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

async function dispatchToolCall(name, args) {
  switch (name) {
    case 'remove_background_file':
      return handleRemoveBackgroundFile(args);
    case 'remove_background_url':
      return handleRemoveBackgroundUrl(args);
    case 'remove_background_batch':
      return handleRemoveBackgroundBatch(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function writeResponse(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeResult(id, result) {
  writeResponse({ jsonrpc: '2.0', id, result });
}

function writeError(id, code, message) {
  writeResponse({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleMessage(msg) {
  const hasId = msg && msg.id !== undefined && msg.id !== null;
  if (!msg || typeof msg.method !== 'string') {
    if (hasId) {
      writeError(msg.id, -32600, 'Invalid Request');
    }
    return;
  }

  const { id, method, params } = msg;

  switch (method) {
    case 'initialize': {
      const clientVersion = params?.protocolVersion;
      if (hasId) {
        writeResult(id, {
          protocolVersion: typeof clientVersion === 'string' && clientVersion ? clientVersion : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      }
      return;
    }

    case 'notifications/initialized':
      return;

    case 'ping':
      if (hasId) writeResult(id, {});
      return;

    case 'tools/list':
      if (hasId) writeResult(id, { tools: TOOLS });
      return;

    case 'tools/call': {
      const toolName = params?.name;
      const toolArgs = params?.arguments ?? {};
      try {
        const result = await dispatchToolCall(toolName, toolArgs);
        if (hasId) {
          writeResult(id, {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (hasId) {
          writeResult(id, {
            isError: true,
            content: [{ type: 'text', text: errorMessage }],
          });
        }
      }
      return;
    }

    default:
      if (hasId) {
        writeError(id, -32601, `Method not found: ${method}`);
      }
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Number.POSITIVE_INFINITY,
});

// Serialize message handling so writes never interleave and shutdown waits for in-flight tool calls
let queue = Promise.resolve();
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  queue = queue.then(async () => {
    try {
      const parsed = JSON.parse(trimmed);
      await handleMessage(parsed);
    } catch {
      writeError(null, -32700, 'Parse error');
    }
  });
});

rl.on('close', () => {
  queue.finally(() => process.exit(0));
});
