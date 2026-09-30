import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { unzipSync, zipSync, zlibSync } from 'fflate';
import {
  buildRelease,
  deterministicArchive,
  validateArchive,
  validateDirectory,
  validateFiles,
} from './package-tools.mjs';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const integrationDirectory = resolve(scriptsDirectory, '..');

function pngLogo(size = 512) {
  function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data]);
    let checksum = 0xffffffff;
    for (const value of body) {
      checksum ^= value;
      for (let bit = 0; bit < 8; bit++)
        checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE((checksum ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, crc]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', Buffer.from(zlibSync(Buffer.alloc(size * (1 + size * 4))))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function manifest({ demo = true } = {}) {
  return {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'sendit',
    version: '1.2.3',
    description: 'Publish and manage social posts.',
    author: { name: 'Infinite Apps AI' },
    extensions: {
      'com.openai': {
        interface: {
          displayName: 'SendIt',
          shortDescription: 'Social publishing',
          longDescription: 'Connect accounts, preview, publish, and schedule social media posts.',
          developerName: 'Infinite Apps AI',
          category: 'Productivity',
          websiteURL: 'https://sendit.infiniteappsai.com',
          supportURL: 'https://sendit.infiniteappsai.com/support',
          privacyPolicyURL: 'https://sendit.infiniteappsai.com/privacy',
          termsOfServiceURL: 'https://sendit.infiniteappsai.com/terms',
          logo: './assets/logo.png',
          composerIcon: './assets/logo.png',
          defaultPrompt: ['Show my connected social accounts.', 'Preview my next social post.'],
        },
        review: {
          test_cases: {
            positive: Array.from({ length: 5 }, (_, index) => ({
              description: `Distinct supported workflow ${index + 1}.`,
              prompt: `User request ${index + 1}.`,
              tools_triggered: 'list_connected_accounts',
              expected_behavior: 'Returns connected account statuses from the tool response.',
            })),
            negative: Array.from({ length: 3 }, (_, index) => ({
              description: `Unsupported workflow ${index + 1}.`,
              prompt: `Unsupported request ${index + 1}.`,
            })),
          },
          ...(demo ? { demo_recording_url: 'https://sendit.infiniteappsai.com/demo.mp4' } : {}),
        },
        publication: { release_notes: 'Initial packaged public plugin release.', countries: [] },
      },
    },
  };
}

async function fixtureFiles(options) {
  return new Map([
    ['plugin.json', Buffer.from(JSON.stringify(manifest(options)))],
    [
      'mcp.json',
      Buffer.from(
        JSON.stringify({
          $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
          mcpServers: {
            sendit: {
              type: 'streamable-http',
              url: 'https://sendit.infiniteappsai.com/api/mcp/chatgpt',
            },
          },
        })
      ),
    ],
    ['LICENSE', await readFile(join(integrationDirectory, 'LICENSE'))],
    ['assets/logo.png', pngLogo()],
    [
      'skills/sendit/SKILL.md',
      Buffer.from(
        '---\nname: sendit\ndescription: Publish and schedule social media posts using SendIt.\n---\n\nUse actual tool responses.\n'
      ),
    ],
    [
      'skills/sendit/agents/openai.yaml',
      Buffer.from(
        'interface:\n  display_name: SendIt\n  short_description: Social publishing\npolicy:\n  products: [CHAT, CODEX]\n  allow_implicit_invocation: true\ndependencies:\n  tools:\n    - type: mcp\n      value: sendit\n      transport: streamable_http\n      url: https://sendit.infiniteappsai.com/api/mcp/chatgpt\n'
      ),
    ],
  ]);
}

function changeManifest(files, mutate) {
  const value = JSON.parse(files.get('plugin.json').toString('utf8'));
  mutate(value);
  files.set('plugin.json', Buffer.from(JSON.stringify(value)));
}

async function fixtureDirectory(t, files) {
  const directory = await mkdtemp(join(tmpdir(), 'sendit-plugin-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [path, bytes] of files) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), bytes);
  }
  return directory;
}

function firstCentralDirectoryOffset(bytes) {
  for (let offset = 0; offset + 4 <= bytes.length; offset++)
    if (bytes.readUInt32LE(offset) === 0x02014b50) return offset;
  throw new Error('No central directory.');
}

test('a complete remote MCP package passes the official schemas and submission metadata checks', async () => {
  const files = await fixtureFiles();
  const result = await validateFiles(files, { submission: true });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.skills, ['sendit']);
  assert.deepEqual(result.warnings, []);
});

test('missing demo permits packaging with a visible gap but fails submission metadata validation', async () => {
  const files = await fixtureFiles({ demo: false });
  const draft = await validateFiles(files);
  assert.deepEqual(draft.errors, []);
  assert.match(draft.warnings.join('\n'), /verified demo_recording_url/);
  const submission = await validateFiles(files, { submission: true });
  assert.match(submission.errors.join('\n'), /demo_recording_url is missing/);
});

test('legacy root component declarations and unsupported MCP auth fields fail the canonical schemas', async () => {
  const files = await fixtureFiles();
  changeManifest(files, (value) => {
    value.skills = './skills/';
  });
  const mcp = JSON.parse(files.get('mcp.json'));
  mcp.mcpServers.sendit.auth = 'oauth';
  files.set('mcp.json', Buffer.from(JSON.stringify(mcp)));
  const result = await validateFiles(files);
  assert.match(result.errors.join('\n'), /plugin\.json.*additional properties/);
  assert.match(result.errors.join('\n'), /mcp\.json.*additional properties/);
});

test('shadowed compatibility app bindings and hook declarations are rejected', async () => {
  const files = await fixtureFiles();
  files.set(
    '.codex-plugin/plugin.json',
    Buffer.from(
      JSON.stringify({ name: 'sendit', apps: './.app.json', hooks: './hooks/hooks.json' })
    )
  );
  const result = await validateFiles(files);
  assert.match(result.errors.join('\n'), /\.codex-plugin\/plugin\.json root.apps/);
  assert.match(result.errors.join('\n'), /root.hooks/);
});

test('credential files, dependency directories, embedded keys, and source symlinks cannot enter a release', async (t) => {
  const files = await fixtureFiles();
  const directory = await fixtureDirectory(t, files);
  await writeFile(join(directory, '.env.production'), 'SENDIT_API_KEY=private');
  await mkdir(join(directory, 'node_modules'));
  await writeFile(join(directory, 'node_modules/secret.json'), '{}');
  await symlink(join(directory, 'plugin.json'), join(directory, 'alias.json'));
  await writeFile(join(directory, 'credentials.md'), `Private key: sk_live_${'A'.repeat(24)}`);
  const result = await validateDirectory(directory);
  assert.match(result.errors.join('\n'), /credential or environment file/);
  assert.match(result.errors.join('\n'), /dependency, cache, or build directory/);
  assert.match(result.errors.join('\n'), /symlinks cannot be included/);
  await assert.rejects(buildRelease(directory), /Package validation failed/);
  files.set('unsafe-example.md', Buffer.from(`Key: sk_live_${'A'.repeat(24)}`));
  assert.match((await validateFiles(files)).errors.join('\n'), /appears to contain a secret/);
});

test('unsafe asset traversal and invalid skill policy fail with useful errors', async () => {
  const files = await fixtureFiles();
  changeManifest(files, (value) => {
    value.extensions['com.openai'].interface.logo = './../private.png';
  });
  files.set(
    'skills/sendit/agents/openai.yaml',
    Buffer.from(
      'interface:\n  display_name: SendIt\n  short_description: Publish social posts\npolicy:\n  products: [BROWSER]\n  allow_implicit_invocation: yes\n'
    )
  );
  const result = await validateFiles(files);
  assert.match(result.errors.join('\n'), /unsafe path/);
  assert.match(result.errors.join('\n'), /products must contain CHAT, CODEX/);
  assert.match(result.errors.join('\n'), /allow_implicit_invocation must be boolean/);
});

test('review cases must use current field names and exact initial-review counts', async () => {
  const files = await fixtureFiles();
  changeManifest(files, (value) => {
    const cases = value.extensions['com.openai'].review.test_cases;
    cases.positive.push({ ...cases.positive[0], user_prompt: 'Legacy prompt' });
    cases.negative.pop();
  });
  const result = await validateFiles(files);
  assert.match(result.errors.join('\n'), /exactly 5 cases/);
  assert.match(result.errors.join('\n'), /exactly 3 cases/);
  assert.match(result.errors.join('\n'), /current prompt and expected_behavior/);
});

test('submission rejects placeholder URLs, duplicate starter prompts, and undersized listing icons', async () => {
  const files = await fixtureFiles();
  changeManifest(files, (value) => {
    const listing = value.extensions['com.openai'].interface;
    listing.supportURL = 'https://example.com/support';
    listing.defaultPrompt = ['Show accounts.', ' Show   accounts. '];
  });
  files.set('assets/logo.png', pngLogo(64));
  const result = await validateFiles(files, { submission: true });
  assert.match(result.errors.join('\n'), /placeholder or local hostname/);
  assert.match(result.errors.join('\n'), /unique after whitespace/);
  assert.match(result.errors.join('\n'), /at least 256 x 256/);
});

test('a ZIP with symlink mode bits is rejected before extraction', async () => {
  const bytes = deterministicArchive(await fixtureFiles(), 'sendit');
  const offset = firstCentralDirectoryOffset(bytes);
  bytes.writeUInt32LE((0o120777 << 16) >>> 0, offset + 38);
  await assert.rejects(validateArchive(bytes), /symlink or special file/);
});

test('ZIP path collisions and sibling directories are rejected', async () => {
  const files = await fixtureFiles();
  files.set('A.txt', Buffer.from('a'));
  files.set('a.txt', Buffer.from('b'));
  await assert.rejects(
    validateArchive(deterministicArchive(files, 'sendit')),
    /duplicate or colliding path/
  );
  const valid = unzipSync(deterministicArchive(await fixtureFiles(), 'sendit'));
  valid['sibling/'] = new Uint8Array();
  await assert.rejects(validateArchive(Buffer.from(zipSync(valid))), /beside its plugin root/);
});

test('releases are byte-identical after source timestamps change and both real ZIP inventories are inspected', async (t) => {
  const files = await fixtureFiles();
  const directory = await fixtureDirectory(t, files);
  const first = await buildRelease(directory, { submission: true });
  await utimes(join(directory, 'plugin.json'), new Date(), new Date());
  const second = await buildRelease(directory, { submission: true });
  assert.deepEqual(first.archives, second.archives);
  const plugin = first.archives['sendit-openai-plugin-1.2.3.zip'];
  assert.deepEqual((await validateArchive(plugin, { submission: true })).errors, []);
  const standalone = unzipSync(first.archives['sendit-skill-1.2.3.zip']);
  assert.ok(standalone['sendit/SKILL.md']);
  assert.ok(standalone['sendit/agents/openai.yaml']);
  assert.ok(standalone['sendit/LICENSE']);
  assert.equal(
    first.report.artifacts['sendit-openai-plugin-1.2.3.zip'].sha256,
    createHash('sha256').update(plugin).digest('hex')
  );
});

test('deterministic ZIP timestamps produce the same bytes across time zones', () => {
  const script = `import { deterministicArchive } from ${JSON.stringify(join(scriptsDirectory, 'package-tools.mjs'))};\nimport { createHash } from 'node:crypto';\nconsole.log(createHash('sha256').update(deterministicArchive(new Map([['a.txt',Buffer.from('same')]]),'sendit')).digest('hex'));`;
  const run = (timezone) =>
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: timezone },
      encoding: 'utf8',
    }).trim();
  assert.equal(run('Pacific/Honolulu'), run('Asia/Kolkata'));
});
