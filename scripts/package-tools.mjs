import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { unzipSync, zipSync } from 'fflate';
import { parse as parseYaml } from 'yaml';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
export const defaultPluginDirectory = resolve(scriptsDirectory, '../plugins/sendit');
const maximumZipBytes = 100_000_000;
const maximumExpandedBytes = 512 * 1024 * 1024;
const maximumEntryBytes = 100 * 1024 * 1024;
const imageLimit = 5 * 1024 * 1024;
const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const portableName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const forbiddenDirectories = new Set(['node_modules', '.git', '.vercel', '.cache', 'dist']);
const manifestPaths = [
  'plugin.json',
  '.codex-plugin/plugin.json',
  '.agent-plugin/plugin.json',
  '.claude-plugin/plugin.json',
];
const listingURLFields = ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL'];
let validators;

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(result, condition, message) {
  if (!condition) result.errors.push(message);
}

function parseJson(bytes, path, result) {
  if (!bytes) {
    result.errors.push(`Missing ${path}.`);
    return {};
  }
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!object(value)) throw new Error('must contain an object');
    return value;
  } catch (error) {
    result.errors.push(`${path}: ${error.message}`);
    return {};
  }
}

function forbiddenPath(path) {
  const segments = path.split('/');
  if (segments.some((segment) => forbiddenDirectories.has(segment)))
    return 'dependency, cache, or build directory';
  if (segments.includes('.app.json')) return 'private registered app binding';
  if (segments.includes('hooks')) return 'lifecycle hooks are unsupported in public uploads';
  if (
    segments.some(
      (segment) =>
        /^\.env(?:\.|$)/i.test(segment) ||
        /^\.npmrc$/i.test(segment) ||
        /^(?:credentials|tokens?)(?:\.|$)/i.test(segment)
    )
  )
    return 'credential or environment file';
  if (/\.(?:pem|key|p12|pfx)$/i.test(path)) return 'private key file';
  return null;
}

function safePath(path) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path === path.trim() &&
    !isAbsolute(path) &&
    !/^[A-Za-z]:/.test(path) &&
    !path.includes('\\') &&
    !/[\u0000-\u001f]/.test(path) &&
    path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..') &&
    path.split('/').length <= 20
  );
}

async function officialValidators() {
  if (validators) return validators;
  const sources = JSON.parse(
    await readFile(join(scriptsDirectory, 'schemas/sources.json'), 'utf8')
  );
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  validators = {};
  for (const name of ['plugin', 'mcp']) {
    const bytes = await readFile(join(scriptsDirectory, `schemas/${name}.schema.json`));
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (sources[name]?.sha256 !== checksum)
      throw new Error(
        `Official ${name} schema checksum differs. Refresh using npm run schemas:refresh.`
      );
    const schema = JSON.parse(bytes.toString('utf8'));
    if (schema.$id !== sources[name].url)
      throw new Error(`Official ${name} schema identity differs.`);
    validators[name] = ajv.compile(schema);
  }
  return validators;
}

async function collectFiles(directory) {
  const result = { errors: [], files: new Map() };
  async function visit(path) {
    const name = relative(directory, path).split('\\').join('/');
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      result.errors.push(`${name || '.'}: symlinks cannot be included in public packages.`);
      return;
    }
    if (name && forbiddenPath(name)) {
      result.errors.push(`${name}: ${forbiddenPath(name)} cannot be included in public packages.`);
      return;
    }
    if (stat.isDirectory()) {
      for (const child of (await readdir(path)).sort()) await visit(join(path, child));
    } else if (stat.isFile()) {
      if (!safePath(name)) result.errors.push(`${name}: invalid package path.`);
      else if (stat.size > maximumEntryBytes)
        result.errors.push(`${name}: exceeds the 100 MiB entry limit.`);
      else result.files.set(name, await readFile(path));
    } else {
      result.errors.push(`${name}: only regular files and directories are supported.`);
    }
  }
  await visit(directory);
  return result;
}

function httpsURL(value, label, result, limit = 1024) {
  fail(
    result,
    typeof value === 'string' && value.trim().length > 0 && value.length <= limit,
    `${label} must be a nonblank HTTPS URL of at most ${limit} characters.`
  );
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    fail(
      result,
      url.protocol === 'https:' && !url.username && !url.password,
      `${label} must use HTTPS without embedded credentials.`
    );
    fail(
      result,
      !/(?:^|\.)(?:example\.(?:com|org|net)|localhost|invalid)$/.test(url.hostname),
      `${label} uses a placeholder or local hostname.`
    );
  } catch {
    result.errors.push(`${label} must be a valid absolute URL.`);
  }
}

function boundedText(value, label, result, limit, required = true) {
  if (value === undefined && !required) return;
  fail(
    result,
    typeof value === 'string' && value.trim().length > 0 && value.length <= limit,
    `${label} must be nonblank text of at most ${limit} characters.`
  );
}

function imageDimensions(bytes, extension) {
  if (
    extension === '.png' &&
    bytes.length >= 33 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString('ascii', 12, 16) === 'IHDR' &&
    bytes.includes(Buffer.from('IEND'))
  ) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), raster: true };
  }
  if (['.jpg', '.jpeg'].includes(extension) && bytes.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset + 9 <= bytes.length) {
      if (bytes[offset++] !== 0xff) continue;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker
        )
      ) {
        return {
          width: bytes.readUInt16BE(offset + 5),
          height: bytes.readUInt16BE(offset + 3),
          raster: true,
        };
      }
      offset += length;
    }
  }
  if (
    extension === '.webp' &&
    bytes.length >= 30 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const kind = bytes.toString('ascii', 12, 16);
    if (kind === 'VP8X')
      return {
        width: bytes.readUIntLE(24, 3) + 1,
        height: bytes.readUIntLE(27, 3) + 1,
        raster: true,
      };
    if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, raster: true };
    }
    if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)
      return {
        width: bytes.readUInt16LE(26) & 0x3fff,
        height: bytes.readUInt16LE(28) & 0x3fff,
        raster: true,
      };
  }
  if (extension === '.svg') {
    const svg = bytes.toString('utf8').match(/<svg\b([^>]*)>/i)?.[1];
    if (!svg) return null;
    const width = Number(svg.match(/\bwidth=["'](\d+(?:\.\d+)?)(?:px)?["']/i)?.[1]);
    const height = Number(svg.match(/\bheight=["'](\d+(?:\.\d+)?)(?:px)?["']/i)?.[1]);
    if (width && height) return { width, height, raster: false };
    const viewBox = svg
      .match(/\bviewBox=["']([^"']+)["']/i)?.[1]
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (viewBox?.length === 4 && viewBox.every(Number.isFinite))
      return { width: viewBox[2], height: viewBox[3], raster: false };
  }
  return null;
}

function asset(
  value,
  label,
  result,
  files,
  { prefix = '', square = false, minimum = 48, png = false } = {}
) {
  fail(
    result,
    typeof value === 'string' && value.startsWith('./'),
    `${label} must be a contained ./-prefixed relative path.`
  );
  if (typeof value !== 'string') return;
  const path = value.replace(/^\.\//, '');
  fail(result, safePath(path), `${label} contains an unsafe path.`);
  if (!safePath(path)) return;
  const bytes = files.get(prefix + path);
  fail(result, Boolean(bytes), `${label} references missing file ${prefix + path}.`);
  if (!bytes) return;
  fail(result, bytes.length <= imageLimit, `${label} exceeds 5 MiB.`);
  const extension = posix.extname(path).toLowerCase();
  if (png) fail(result, extension === '.png', `${label} must be PNG for public submission.`);
  let dimensions;
  try {
    dimensions = imageDimensions(bytes, extension);
  } catch {
    dimensions = null;
  }
  fail(result, Boolean(dimensions), `${label} must be a supported PNG, JPEG, WebP, or SVG image.`);
  if (!dimensions) return;
  if (square)
    fail(
      result,
      dimensions.width === dimensions.height && dimensions.width >= minimum,
      `${label} must be square and at least ${minimum} x ${minimum}.`
    );
  if (dimensions.raster)
    fail(
      result,
      dimensions.width <= 4096 && dimensions.height <= 4096,
      `${label} raster dimensions must not exceed 4096.`
    );
}

function validateListing(manifest, result, files, options) {
  const extension = manifest.extensions?.['com.openai'];
  fail(result, object(extension), 'extensions.com.openai must contain public listing metadata.');
  const listing = extension?.interface;
  if (!object(listing)) {
    result.errors.push('extensions.com.openai.interface must be an object.');
    return;
  }
  for (const [field, limit] of Object.entries({
    displayName: 30,
    shortDescription: 30,
    longDescription: 4000,
    developerName: 80,
    category: 80,
  }))
    boundedText(listing[field], `interface.${field}`, result, limit);
  for (const field of listingURLFields) httpsURL(listing[field], `interface.${field}`, result);
  for (const field of ['logo', 'composerIcon'])
    asset(listing[field], `interface.${field}`, result, files, {
      square: true,
      minimum: field === 'logo' && options.submission ? 256 : 48,
      png: options.submission,
    });
  for (const field of ['logoDark', 'composerIconDark'])
    if (listing[field] !== undefined)
      asset(listing[field], `interface.${field}`, result, files, { square: true });
  if (listing.screenshots !== undefined) {
    fail(result, Array.isArray(listing.screenshots), 'interface.screenshots must be an array.');
    if (Array.isArray(listing.screenshots))
      listing.screenshots.forEach((path, index) =>
        asset(path, `interface.screenshots[${index}]`, result, files)
      );
  }
  if (listing.capabilities !== undefined)
    fail(
      result,
      Array.isArray(listing.capabilities) &&
        listing.capabilities.length <= 20 &&
        listing.capabilities.every(
          (value) => typeof value === 'string' && value.trim() && value.length <= 120
        ),
      'interface.capabilities must contain at most 20 nonblank labels of at most 120 characters.'
    );
  for (const field of ['brandColor', 'brandColorDark'])
    if (listing[field] !== undefined)
      fail(result, /^#[0-9A-Fa-f]{6}$/.test(listing[field]), `interface.${field} must be #RRGGBB.`);
  if (listing.defaultPrompt !== undefined) {
    const prompts = Array.isArray(listing.defaultPrompt)
      ? listing.defaultPrompt
      : [listing.defaultPrompt];
    fail(
      result,
      prompts.length > 0 && prompts.length <= 3,
      'interface.defaultPrompt must contain one to three starter prompts.'
    );
    for (const prompt of prompts)
      fail(
        result,
        typeof prompt === 'string' &&
          prompt.trim() &&
          prompt.length <= 128 &&
          !/[\r\n@]/.test(prompt),
        'Starter prompts must be single-line text of at most 128 characters without @mentions.'
      );
    fail(
      result,
      new Set(
        prompts.map((prompt) =>
          typeof prompt === 'string' ? prompt.trim().replace(/\s+/g, ' ') : prompt
        )
      ).size === prompts.length,
      'Starter prompts must be unique after whitespace normalization.'
    );
  }
  const publication = extension?.publication;
  if (publication !== undefined) {
    fail(result, object(publication), 'publication must be an object.');
    if (publication?.countries !== undefined)
      fail(
        result,
        Array.isArray(publication.countries) &&
          publication.countries.every(
            (code) => typeof code === 'string' && /^[A-Z]{2}$/.test(code)
          ),
        'publication.countries must contain uppercase two-letter country codes, or [] for all permitted countries.'
      );
    boundedText(
      publication?.release_notes,
      'publication.release_notes',
      result,
      4000,
      options.submission
    );
  } else if (options.submission)
    result.errors.push('publication.release_notes is required for submission preparation.');
}

function validateReview(extension, result, options) {
  const review = extension?.review;
  fail(result, object(review), 'MCP package must include extensions.com.openai.review.');
  if (!object(review)) return;
  fail(
    result,
    !('test_credentials' in review) && !('reviewer_instructions' in review),
    'Reviewer credentials and instructions belong only in secure portal fields.'
  );
  for (const [kind, count] of [
    ['positive', 5],
    ['negative', 3],
  ]) {
    const cases = review.test_cases?.[kind];
    fail(
      result,
      Array.isArray(cases) && cases.length === count,
      `review.test_cases.${kind} must contain exactly ${count} cases.`
    );
    if (!Array.isArray(cases)) continue;
    for (const [index, entry] of cases.entries()) {
      const label = `review.test_cases.${kind}[${index}]`;
      if (!object(entry)) {
        result.errors.push(`${label} must be an object.`);
        continue;
      }
      for (const field of kind === 'positive'
        ? ['description', 'prompt', 'tools_triggered', 'expected_behavior']
        : ['description', 'prompt'])
        boundedText(entry[field], `${label}.${field}`, result, 4000);
      fail(
        result,
        !('user_prompt' in entry) && !('expected_output' in entry),
        `${label} must use current prompt and expected_behavior field names.`
      );
      if (entry.file_attachment_urls !== undefined) {
        fail(
          result,
          Array.isArray(entry.file_attachment_urls),
          `${label}.file_attachment_urls must be an array.`
        );
        if (Array.isArray(entry.file_attachment_urls))
          entry.file_attachment_urls.forEach((url, i) =>
            httpsURL(url, `${label}.file_attachment_urls[${i}]`, result)
          );
      }
      if (entry.expected_output_url !== undefined)
        httpsURL(entry.expected_output_url, `${label}.expected_output_url`, result);
    }
  }
  if (review.demo_recording_url)
    httpsURL(review.demo_recording_url, 'review.demo_recording_url', result);
  else if (options.submission)
    result.errors.push(
      'review.demo_recording_url is missing. Record and verify a reviewer-accessible demo before submission.'
    );
  else result.warnings.push('A verified demo_recording_url is required before MCP submission.');
  if (review.commerce !== undefined)
    fail(result, typeof review.commerce === 'boolean', 'review.commerce must be a boolean.');
  if (review.commerce === true)
    boundedText(review.commerce_description, 'review.commerce_description', result, 4000);
}

function validateSkills(manifest, result, files) {
  const skillPaths = [...files.keys()].filter((path) => /^skills\/[^/]+\/SKILL\.md$/.test(path));
  fail(result, skillPaths.length > 0, 'Package must contain at least one bundled skill.');
  const names = new Set();
  for (const path of skillPaths) {
    const prefix = path.slice(0, path.lastIndexOf('/') + 1);
    const directoryName = path.split('/')[1];
    const text = files.get(path).toString('utf8');
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!frontmatter) {
      result.errors.push(`${path} must start with YAML frontmatter.`);
      continue;
    }
    let metadata;
    try {
      metadata = parseYaml(frontmatter[1], { uniqueKeys: true });
    } catch (error) {
      result.errors.push(`${path}: invalid YAML: ${error.message}`);
      continue;
    }
    if (!object(metadata)) {
      result.errors.push(`${path} frontmatter must contain an object.`);
      continue;
    }
    fail(
      result,
      typeof metadata.name === 'string' &&
        portableName.test(metadata.name) &&
        metadata.name === directoryName &&
        `${manifest.name}:${metadata.name}`.length <= 64,
      `${path} name must match its kebab-case directory and plugin:skill must fit 64 characters.`
    );
    boundedText(metadata.description, `${path} description`, result, 1024);
    fail(result, !names.has(metadata.name), `${path} duplicates skill name ${metadata.name}.`);
    names.add(metadata.name);
    result.skills.push(metadata.name);
    const agentPath = `${prefix}agents/openai.yaml`;
    if (!files.has(agentPath)) continue;
    let agent;
    try {
      agent = parseYaml(files.get(agentPath).toString('utf8'), { uniqueKeys: true });
    } catch (error) {
      result.errors.push(`${agentPath}: invalid YAML: ${error.message}`);
      continue;
    }
    if (!object(agent) || !object(agent.interface)) {
      result.errors.push(`${agentPath} must include an interface object.`);
      continue;
    }
    boundedText(agent.interface.display_name, `${agentPath} display_name`, result, 64);
    boundedText(agent.interface.short_description, `${agentPath} short_description`, result, 120);
    boundedText(agent.interface.default_prompt, `${agentPath} default_prompt`, result, 4000, false);
    for (const field of ['icon_small', 'icon_large'])
      if (agent.interface[field] !== undefined)
        asset(agent.interface[field], `${agentPath} ${field}`, result, files, {
          prefix,
          square: true,
        });
    if (agent.policy !== undefined) {
      fail(
        result,
        object(agent.policy) &&
          Object.keys(agent.policy).every((key) =>
            ['products', 'allow_implicit_invocation'].includes(key)
          ),
        `${agentPath} policy supports only products and allow_implicit_invocation.`
      );
      if (agent.policy?.allow_implicit_invocation !== undefined)
        fail(
          result,
          typeof agent.policy.allow_implicit_invocation === 'boolean',
          `${agentPath} allow_implicit_invocation must be boolean.`
        );
      if (agent.policy?.products !== undefined)
        fail(
          result,
          Array.isArray(agent.policy.products) &&
            agent.policy.products.length > 0 &&
            agent.policy.products.every((product) => ['CHAT', 'CODEX'].includes(product)),
          `${agentPath} products must contain CHAT, CODEX, or both.`
        );
    }
    if (agent.dependencies !== undefined) {
      fail(
        result,
        object(agent.dependencies) &&
          Object.keys(agent.dependencies).every((key) => key === 'tools') &&
          Array.isArray(agent.dependencies.tools),
        `${agentPath} dependencies supports only a tools array.`
      );
      if (Array.isArray(agent.dependencies?.tools))
        for (const tool of agent.dependencies.tools) {
          fail(
            result,
            object(tool) &&
              tool.type === 'mcp' &&
              typeof tool.value === 'string' &&
              tool.value.trim().length > 0,
            `${agentPath} MCP dependencies need type mcp and a nonblank value.`
          );
          if (tool.transport !== undefined)
            fail(
              result,
              ['streamable_http', 'sse', 'stdio'].includes(tool.transport),
              `${agentPath} dependency transport is unsupported.`
            );
          if (tool.url !== undefined) httpsURL(tool.url, `${agentPath} dependency URL`, result);
        }
    }
  }
  const onboarding = manifest.extensions?.['com.openai']?.onboardingSkill;
  if (onboarding !== undefined)
    fail(
      result,
      typeof onboarding === 'string' &&
        onboarding.startsWith('./') &&
        skillPaths.includes(onboarding.slice(2)),
      'onboardingSkill must reference an included ./skills/<name>/SKILL.md.'
    );
}

async function onlineChecks(manifest, result) {
  const extension = manifest.extensions?.['com.openai'];
  const urls = listingURLFields.map((field) => [field, extension?.interface?.[field]]);
  if (extension?.review?.demo_recording_url)
    urls.push(['demo_recording_url', extension.review.demo_recording_url]);
  await Promise.all(
    urls.map(async ([field, url]) => {
      if (typeof url !== 'string') return;
      try {
        const response = await fetch(url, {
          method: field === 'demo_recording_url' ? 'HEAD' : 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(20_000),
        });
        fail(result, response.ok, `${field} is not publicly accessible (${response.status}).`);
        if (!response.ok) return;
        if (field === 'demo_recording_url') {
          fail(
            result,
            /video\/|text\/html/i.test(response.headers.get('content-type') || ''),
            'Demo recording URL must serve video or a reviewer-accessible video page.'
          );
        } else {
          const content = await response.text();
          fail(
            result,
            /SendIt|Infinite Apps/i.test(content),
            `${field} content does not identify SendIt or its publisher.`
          );
          if (field === 'supportURL')
            fail(
              result,
              /support|contact|help/i.test(content),
              'supportURL content must explain how to get help.'
            );
          if (field === 'privacyPolicyURL')
            fail(
              result,
              /privacy/i.test(content),
              'privacyPolicyURL must serve the privacy policy.'
            );
          if (field === 'termsOfServiceURL')
            fail(result, /terms/i.test(content), 'termsOfServiceURL must serve terms of service.');
        }
      } catch (error) {
        result.errors.push(`${field} online check failed: ${error.message}`);
      }
    })
  );
  if (extension?.review?.demo_recording_url)
    result.warnings.push(
      'Online demo check verifies access and media type; playback and current workflow coverage still require inspection.'
    );
}

export async function validateFiles(files, options = {}) {
  const result = { errors: [], warnings: [], files: [...files.keys()].sort(), skills: [] };
  fail(result, files.size <= 5000, 'Package exceeds 5,000 entries.');
  let expandedSize = 0;
  const normalizedNames = new Set();
  for (const [path, bytes] of files) {
    fail(result, safePath(path), `${path}: invalid package path.`);
    fail(
      result,
      !forbiddenPath(path),
      `${path}: ${forbiddenPath(path)} cannot be included in public packages.`
    );
    const normalized = path.normalize('NFC').toLowerCase();
    fail(
      result,
      !normalizedNames.has(normalized),
      `${path}: path collides after case/Unicode normalization.`
    );
    normalizedNames.add(normalized);
    fail(result, bytes.length <= maximumEntryBytes, `${path} exceeds 100 MiB.`);
    expandedSize += bytes.length;
    if (/\.(?:json|ya?ml|md|txt|mjs|cjs|ts|js)$/i.test(path)) {
      const text = bytes.toString('utf8');
      fail(
        result,
        !/\b(?:sk_live_|sk_test_)[A-Za-z0-9]{20,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/.test(
          text
        ),
        `${path} appears to contain a secret.`
      );
    }
  }
  fail(result, expandedSize <= maximumExpandedBytes, 'Package exceeds the 512 MiB expanded limit.');
  const manifest = parseJson(files.get('plugin.json'), 'plugin.json', result);
  result.manifest = manifest;
  const schemas = await officialValidators();
  if (!schemas.plugin(manifest))
    for (const error of schemas.plugin.errors)
      result.errors.push(`plugin.json${error.instancePath}: ${error.message}`);
  fail(
    result,
    typeof manifest.name === 'string' &&
      portableName.test(manifest.name) &&
      manifest.name.length <= 64,
    'plugin.json name must be lowercase kebab-case of at most 64 characters.'
  );
  fail(
    result,
    typeof manifest.version === 'string' && semver.test(manifest.version),
    'plugin.json version must be semantic versioning.'
  );
  boundedText(manifest.description, 'plugin.json description', result, 1024);
  boundedText(manifest.author?.name, 'plugin.json author.name', result, 120);
  for (const path of manifestPaths.filter((path) => files.has(path))) {
    const declaration =
      path === 'plugin.json' ? manifest : parseJson(files.get(path), path, result);
    for (const [scope, value] of [
      ['root', declaration],
      ['extensions.com.openai', declaration.extensions?.['com.openai']],
    ]) {
      if (!object(value)) continue;
      fail(
        result,
        value.apps == null,
        `${path} ${scope}.apps cannot be declared in public uploads.`
      );
      fail(
        result,
        value.hooks == null,
        `${path} ${scope}.hooks cannot be declared in public uploads.`
      );
    }
  }
  const mcp = parseJson(files.get('mcp.json'), 'mcp.json', result);
  if (!schemas.mcp(mcp))
    for (const error of schemas.mcp.errors)
      result.errors.push(`mcp.json${error.instancePath}: ${error.message}`);
  const servers = object(mcp.mcpServers) ? Object.entries(mcp.mcpServers) : [];
  fail(
    result,
    servers.length === 1,
    'Public SendIt plugin must configure exactly one remote MCP server.'
  );
  for (const [name, server] of servers) {
    fail(
      result,
      server?.type === 'streamable-http',
      `MCP server ${name} must use streamable-http.`
    );
    httpsURL(server?.url, `MCP server ${name} URL`, result);
    if (object(server?.headers))
      for (const [key, value] of Object.entries(server.headers)) {
        if (/authorization|api[-_]?key|token/i.test(key))
          fail(
            result,
            typeof value === 'string' && /\$\{[A-Z_][A-Z0-9_]*\}/.test(value),
            `MCP server ${name} ${key} must not embed credentials.`
          );
      }
  }
  validateListing(manifest, result, files, options);
  validateReview(manifest.extensions?.['com.openai'], result, options);
  validateSkills(manifest, result, files);
  fail(
    result,
    files.has('LICENSE') && files.get('LICENSE').toString('utf8').includes('MIT License'),
    'Package must contain its MIT LICENSE.'
  );
  if (options.online) await onlineChecks(manifest, result);
  return result;
}

export async function validateDirectory(directory, options = {}) {
  const source = await collectFiles(directory);
  const result = await validateFiles(source.files, options);
  result.errors.unshift(...source.errors);
  result.fileBytes = source.files;
  return result;
}

function archiveEntries(bytes) {
  if (bytes.length > maximumZipBytes) throw new Error('Compressed ZIP exceeds 100 MB.');
  // Inspect the directory before inflation: unzip libraries often discard duplicate
  // names and Unix mode bits, and oversized entries must be rejected before allocation.
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65_557); end--) {
    if (
      bytes.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + bytes.readUInt16LE(end + 20) === bytes.length
    )
      break;
  }
  if (end < 0 || end < bytes.length - 65_557)
    throw new Error('ZIP has no valid end-of-directory record.');
  if (bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0)
    throw new Error('Multi-volume ZIP files are unsupported.');
  const entryCount = bytes.readUInt16LE(end + 10);
  if (!entryCount || entryCount > 5000) throw new Error('ZIP must contain one to 5,000 entries.');
  let offset = bytes.readUInt32LE(end + 16);
  const centralPaths = [];
  const normalizedNames = new Set();
  let expandedSize = 0;
  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new Error('ZIP central directory is malformed.');
    const flags = bytes.readUInt16LE(offset + 8);
    const compression = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > end) throw new Error('ZIP central entry exceeds its directory.');
    const path = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (!safePath(path.replace(/\/$/, ''))) throw new Error(`ZIP contains unsafe path ${path}.`);
    const normalized = path.replace(/\/$/, '').normalize('NFC').toLowerCase();
    if (normalizedNames.has(normalized))
      throw new Error(`ZIP contains duplicate or colliding path ${path}.`);
    normalizedNames.add(normalized);
    const unixType = (bytes.readUInt32LE(offset + 38) >>> 16) & 0o170000;
    if (![0, 0o100000, 0o040000].includes(unixType))
      throw new Error(`ZIP contains a symlink or special file ${path}.`);
    if (flags & 1 || ![0, 8].includes(compression))
      throw new Error(`ZIP entry ${path} uses encryption or unsupported compression.`);
    if (size > maximumEntryBytes) throw new Error(`ZIP entry ${path} exceeds 100 MiB.`);
    expandedSize += size;
    if (expandedSize > maximumExpandedBytes)
      throw new Error('ZIP exceeds the 512 MiB expanded limit.');
    centralPaths.push(path);
    offset = entryEnd;
  }
  if (offset !== end) throw new Error('ZIP directory size does not match its entries.');
  const files = unzipSync(bytes, {
    filter(entry) {
      if (entry.originalSize > maximumEntryBytes)
        throw new Error(`${entry.name} exceeds the 100 MiB entry limit.`);
      return true;
    },
  });
  const names = Object.keys(files).filter((path) => !path.endsWith('/'));
  if (!names.length) throw new Error('ZIP is empty.');
  const candidates = names.filter(
    (path) => path === 'plugin.json' || /^[^/]+\/plugin\.json$/.test(path)
  );
  if (candidates.length !== 1) throw new Error('ZIP must contain exactly one plugin root.');
  const prefix = candidates[0].slice(0, -'plugin.json'.length);
  if (centralPaths.some((path) => !path.startsWith(prefix)))
    throw new Error('ZIP has files beside its plugin root.');
  const result = new Map();
  for (const path of names) {
    if (!safePath(path)) throw new Error(`ZIP contains unsafe path ${path}.`);
    result.set(path.slice(prefix.length), Buffer.from(files[path]));
  }
  return result;
}

export async function validateArchive(bytes, options = {}) {
  return validateFiles(archiveEntries(bytes), options);
}

export function deterministicArchive(files, prefix) {
  const entries = {};
  for (const path of [...files.keys()].sort()) {
    entries[`${prefix}/${path}`] = [
      files.get(path),
      { mtime: new Date(1980, 0, 1), os: 3, attrs: 0o100644 << 16 },
    ];
  }
  return Buffer.from(zipSync(entries, { level: 9 }));
}

export async function buildRelease(directory, options = {}) {
  const source = await validateDirectory(directory, options);
  if (source.errors.length)
    throw new Error(
      `Package validation failed:\n${source.errors.map((error) => `- ${error}`).join('\n')}`
    );
  const version = source.manifest.version;
  const pluginZip = deterministicArchive(source.fileBytes, source.manifest.name);
  const inspected = await validateArchive(pluginZip, options);
  if (inspected.errors.length)
    throw new Error(`Built ZIP validation failed:\n${inspected.errors.join('\n')}`);
  const archives = { [`sendit-openai-plugin-${version}.zip`]: pluginZip };
  const skillFiles = new Map();
  for (const [path, bytes] of source.fileBytes) {
    const prefix = 'skills/sendit/';
    if (path.startsWith(prefix)) skillFiles.set(path.slice(prefix.length), bytes);
  }
  if (!skillFiles.has('SKILL.md'))
    throw new Error('Standalone skill release requires skills/sendit/SKILL.md.');
  skillFiles.set('LICENSE', source.fileBytes.get('LICENSE'));
  const skillZip = deterministicArchive(skillFiles, 'sendit');
  const extractedSkill = unzipSync(skillZip);
  if (
    !extractedSkill['sendit/SKILL.md'] ||
    Object.keys(extractedSkill).some((path) => forbiddenPath(path) || !safePath(path))
  )
    throw new Error('Built standalone skill ZIP failed inventory validation.');
  archives[`sendit-skill-${version}.zip`] = skillZip;
  const report = {
    name: source.manifest.name,
    version,
    files: inspected.files,
    skills: inspected.skills,
    submissionMetadataValidated: Boolean(options.submission),
    warnings: source.warnings,
    artifacts: Object.fromEntries(
      Object.entries(archives).map(([name, bytes]) => [
        name,
        { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
      ])
    ),
  };
  return { version, archives, report, warnings: source.warnings };
}
