#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const schemaDirectory = join(dirname(fileURLToPath(import.meta.url)), 'schemas');
await mkdir(schemaDirectory, { recursive: true });
const sources = {};
for (const name of ['plugin', 'mcp']) {
  const url = `https://agent-plugins.org/schemas/1.0.0/${name}.schema.json`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Schema download failed: ${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const schema = JSON.parse(bytes.toString('utf8'));
  if (schema.$id !== url) throw new Error(`Unexpected schema identity: ${url}`);
  await writeFile(join(schemaDirectory, `${name}.schema.json`), bytes);
  sources[name] = { url, sha256: createHash('sha256').update(bytes).digest('hex') };
}
await writeFile(join(schemaDirectory, 'sources.json'), `${JSON.stringify(sources, null, 2)}\n`);
console.log('Downloaded unchanged official Agent Plugins 1.0.0 schemas.');
