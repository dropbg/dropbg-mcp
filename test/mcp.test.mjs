import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_BIN = path.resolve(__dirname, '../bin/dropbg-mcp.mjs');

// Minimal valid 1x1 transparent PNG
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

function startMockApi() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString('utf8');
      requests.push({
        method: req.method,
        url: req.url,
        contentType: req.headers['content-type'] || '',
        bodyText,
      });
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'X-Width': '800',
        'X-Height': '600',
        'X-Processing-Time-Ms': '42',
        'X-RateLimit-Remaining': '9',
        'X-RateLimit-Reset': '3600',
      });
      res.end(PNG_1X1);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        requests,
        url: `http://127.0.0.1:${address.port}/v1.0/removebg`,
      });
    });
  });
}

function createRpcClient(apiUrl) {
  const child = spawn(process.execPath, [SERVER_BIN], {
    env: { ...process.env, DROPBG_API_URL: apiUrl },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const pending = new Map();
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    const msg = JSON.parse(line);
    const handler = pending.get(msg.id);
    if (handler) {
      pending.delete(msg.id);
      handler(msg);
    }
  });

  let nextId = 1;
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`RPC timeout for ${method}`));
      }, 5000);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

  const notify = (method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  };

  const close = () =>
    new Promise((resolve) => {
      rl.close();
      child.on('exit', resolve);
      child.stdin.end();
    });

  return { call, notify, close };
}

test('DropBG MCP server end-to-end stdio flow', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dropbg-mcp-test-'));
  const mock = await startMockApi();
  const client = createRpcClient(mock.url);

  try {
    // 1. initialize
    const initRes = await client.call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '0.1.0' },
    });
    assert.equal(initRes.result.protocolVersion, '2024-11-05');
    assert.equal(initRes.result.serverInfo.name, 'dropbg-mcp');

    client.notify('notifications/initialized', {});

    // 2. tools/list
    const listRes = await client.call('tools/list', {});
    const toolNames = listRes.result.tools.map((t) => t.name);
    assert.deepEqual(toolNames, ['remove_background_file', 'remove_background_url', 'remove_background_batch']);

    // 3. remove_background_file
    const inputPath = path.join(tmpDir, 'sample.jpg');
    const fileOutPath = path.join(tmpDir, 'nested', 'sample_cutout.png');
    await fs.writeFile(inputPath, PNG_1X1);

    const fileCallRes = await client.call('tools/call', {
      name: 'remove_background_file',
      arguments: {
        input_path: inputPath,
        output_path: fileOutPath,
        bg_color: '#FFFFFF',
        format: 'png',
      },
    });
    assert.equal(fileCallRes.result.isError, undefined);
    const fileMeta = JSON.parse(fileCallRes.result.content[0].text);
    assert.equal(fileMeta.output_path, fileOutPath);
    assert.equal(fileMeta.width, 800);
    assert.equal(fileMeta.height, 600);
    assert.equal(fileMeta.processing_time_ms, 42);
    assert.equal(fileMeta.quota_remaining, 9);
    const writtenFile = await fs.readFile(fileOutPath);
    assert.deepEqual(writtenFile, PNG_1X1);

    // 4. remove_background_url
    const urlOutPath = path.join(tmpDir, 'remote_cutout.png');
    const urlCallRes = await client.call('tools/call', {
      name: 'remove_background_url',
      arguments: {
        image_url: 'https://example.com/photo.jpg',
        output_path: urlOutPath,
      },
    });
    assert.equal(urlCallRes.result.isError, undefined);
    const urlMeta = JSON.parse(urlCallRes.result.content[0].text);
    assert.equal(urlMeta.output_path, urlOutPath);
    const writtenUrlFile = await fs.readFile(urlOutPath);
    assert.deepEqual(writtenUrlFile, PNG_1X1);
    assert.ok(mock.requests[1].bodyText.includes('https://example.com/photo.jpg'));

    // 5. remove_background_batch
    const batchDir = path.join(tmpDir, 'batch_out');
    const batchCallRes = await client.call('tools/call', {
      name: 'remove_background_batch',
      arguments: {
        input_paths: [inputPath, inputPath],
        output_dir: batchDir,
      },
    });
    assert.equal(batchCallRes.result.isError, undefined);
    const batchMeta = JSON.parse(batchCallRes.result.content[0].text);
    assert.equal(batchMeta.total, 2);
    assert.equal(batchMeta.succeeded, 2);
    assert.equal(batchMeta.failed, 0);
    assert.equal(batchMeta.results[0].output_path, path.join(batchDir, 'sample_cutout.png'));
  } finally {
    await client.close();
    await new Promise((resolve) => mock.server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
