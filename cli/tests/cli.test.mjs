import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { verifyApiKey } from '../dist/verify.js';
import { writeConfig } from '../dist/clients.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const calls = [];
const tools = [
  {
    name: 'get_platform_requirements',
    description: 'Read public platform constraints after authentication.',
    inputSchema: { type: 'object', properties: { platform: { type: 'string' } } },
  },
];
let fixture;
let endpoint;

before(async () => {
  fixture = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    calls.push({ body, authorization: req.headers.authorization });
    if (body.method === 'notifications/initialized') {
      res.writeHead(202).end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    let result;
    switch (body.method) {
      case 'initialize':
        res.setHeader('mcp-session-id', 'session_fixture');
        result = {
          protocolVersion: '2025-06-18',
          serverInfo: { name: 'sendit-fixture', version: '1.0.0' },
          capabilities: { tools: {}, resources: {} },
        };
        break;
      case 'tools/list':
        result = { tools };
        break;
      case 'resources/list':
        result = {
          resources: [{ uri: 'sendit://fixture', name: 'Fixture', mimeType: 'text/plain' }],
        };
        break;
      case 'resources/read':
        result = {
          contents: [{ uri: 'sendit://fixture', mimeType: 'text/plain', text: 'fixture' }],
        };
        break;
      case 'tools/call':
        if (req.headers.authorization !== 'Bearer sk_live_fixture') {
          res.writeHead(401);
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              error: { code: -32001, message: 'Authentication required' },
            })
          );
          return;
        }
        assert.equal(req.headers['mcp-session-id'], 'session_fixture');
        assert.equal(req.headers['mcp-protocol-version'], '2025-06-18');
        result = { content: [{ type: 'text', text: 'Authenticated platform requirements' }] };
        break;
      default:
        throw new Error(`Unexpected fixture method: ${body.method}`);
    }
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${fixture.address().port}/mcp`;
  process.env.SENDIT_MCP_URL = endpoint;
});

after(async () => {
  delete process.env.SENDIT_MCP_URL;
  await new Promise((resolve) => fixture.close(resolve));
});

test('setup rejects an invalid key even when unauthenticated initialization succeeds', async () => {
  const result = await verifyApiKey('invalid-fixture');
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid API key/);
  assert.equal(calls.at(-1).body.method, 'tools/call');
  assert.equal(calls.at(-1).body.params.name, 'get_platform_requirements');
});

test('setup verifies a valid key through an authenticated read-only tool', async () => {
  const result = await verifyApiKey('sk_live_fixture');
  assert.equal(result.ok, true);
});

test('the executable proxies tools, resource reads, and authenticated calls over stdio', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(packageRoot, 'dist/cli.js'), 'serve'],
    env: { ...process.env, SENDIT_API_KEY: 'sk_live_fixture', SENDIT_MCP_URL: endpoint },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'sendit-package-acceptance', version: '1.0.0' });
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools, tools);
    assert.equal((await client.listResources()).resources[0].uri, 'sendit://fixture');
    assert.equal(
      (await client.readResource({ uri: 'sendit://fixture' })).contents[0].text,
      'fixture'
    );
    const result = await client.callTool({
      name: 'get_platform_requirements',
      arguments: { platform: 'linkedin' },
    });
    assert.equal(result.content[0].text, 'Authenticated platform requirements');
  } finally {
    await client.close();
  }
});

test('the installer pins the patched release and preserves other servers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sendit-cli-config-'));
  const path = join(directory, 'client.json');
  const originalPackage = process.env.SENDIT_MCP_PACKAGE;
  delete process.env.SENDIT_MCP_PACKAGE;
  try {
    await writeFile(
      path,
      JSON.stringify({ mcpServers: { existing: { command: 'existing' } }, preference: true })
    );
    writeConfig('claude-desktop', path, 'sk_live_fixture');
    const config = JSON.parse(await readFile(path, 'utf8'));
    assert.deepEqual(config.mcpServers.sendit.args, [
      '-y',
      '--package=https://github.com/Shree-git/sendit-openai-plugin/releases/download/mcp-v0.1.2/senditapp-mcp-0.1.2.tgz',
      'sendit-mcp',
      'serve',
    ]);
    assert.deepEqual(config.mcpServers.existing, { command: 'existing' });
    assert.equal(config.preference, true);
  } finally {
    if (originalPackage === undefined) delete process.env.SENDIT_MCP_PACKAGE;
    else process.env.SENDIT_MCP_PACKAGE = originalPackage;
    await rm(directory, { recursive: true, force: true });
  }
});

test('the distribution override supports explicit npm versions and self-hosted HTTPS tarballs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sendit-cli-override-'));
  const originalPackage = process.env.SENDIT_MCP_PACKAGE;
  try {
    for (const packageSpec of [
      '@example/sendit-mcp@0.1.2',
      '@example/sendit-mcp@^0.1.2',
      'https://downloads.infiniteappsai.com/sendit-mcp-0.1.2.tgz',
    ]) {
      process.env.SENDIT_MCP_PACKAGE = packageSpec;
      const path = join(directory, 'client.json');
      writeConfig('claude-desktop', path, 'sk_live_fixture');
      const config = JSON.parse(await readFile(path, 'utf8'));
      assert.deepEqual(config.mcpServers.sendit.args, [
        '-y',
        `--package=${packageSpec}`,
        'sendit-mcp',
        'serve',
      ]);
    }
  } finally {
    if (originalPackage === undefined) delete process.env.SENDIT_MCP_PACKAGE;
    else process.env.SENDIT_MCP_PACKAGE = originalPackage;
    await rm(directory, { recursive: true, force: true });
  }
});

test('invalid distribution overrides cannot rewrite a client configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sendit-cli-invalid-override-'));
  const originalPackage = process.env.SENDIT_MCP_PACKAGE;
  const path = join(directory, 'client.json');
  const originalConfig = '{"preference":"preserve"}\n';
  try {
    await writeFile(path, originalConfig);
    for (const packageSpec of [
      '',
      ' --package=evil',
      '--yes',
      'file:/private/package.tgz',
      'http://downloads.infiniteappsai.com/package.tgz',
      'https://user:secret@downloads.infiniteappsai.com/package.tgz',
      'https://downloads.infiniteappsai.com/package.tgz?token=private',
      'https://downloads.infiniteappsai.com/package.tgz#fragment',
    ]) {
      process.env.SENDIT_MCP_PACKAGE = packageSpec;
      assert.throws(
        () => writeConfig('claude-desktop', path, 'sk_live_fixture'),
        /SENDIT_MCP_PACKAGE/
      );
      assert.equal(await readFile(path, 'utf8'), originalConfig);
    }
  } finally {
    if (originalPackage === undefined) delete process.env.SENDIT_MCP_PACKAGE;
    else process.env.SENDIT_MCP_PACKAGE = originalPackage;
    await rm(directory, { recursive: true, force: true });
  }
});

test('every generated client config resolves the repaired 0.1.2 executable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sendit-cli-clients-'));
  const originalPackage = process.env.SENDIT_MCP_PACKAGE;
  delete process.env.SENDIT_MCP_PACKAGE;
  try {
    for (const clientId of ['claude-desktop', 'claude-code', 'vscode', 'cursor', 'windsurf']) {
      const path = join(directory, `${clientId}.json`);
      writeConfig(clientId, path, 'sk_live_fixture');
      const config = JSON.parse(await readFile(path, 'utf8'));
      const entry = config.mcpServers?.sendit || config.mcp?.servers?.sendit;
      assert.equal(entry.command, 'npx');
      assert.equal(
        entry.args[1],
        '--package=https://github.com/Shree-git/sendit-openai-plugin/releases/download/mcp-v0.1.2/senditapp-mcp-0.1.2.tgz'
      );
      assert.deepEqual(entry.args.slice(2), ['sendit-mcp', 'serve']);
      assert.ok(!entry.args.includes('@senditapp/mcp'));
    }
  } finally {
    if (originalPackage === undefined) delete process.env.SENDIT_MCP_PACKAGE;
    else process.env.SENDIT_MCP_PACKAGE = originalPackage;
    await rm(directory, { recursive: true, force: true });
  }
});
