#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRelease, defaultPluginDirectory } from './package-tools.mjs';

const argumentsList = process.argv.slice(2);
const pathIndex = argumentsList.indexOf('--path');
const outputIndex = argumentsList.indexOf('--output');
const pluginDirectory =
  pathIndex >= 0 ? resolve(argumentsList[pathIndex + 1]) : defaultPluginDirectory;
const outputDirectory =
  outputIndex >= 0
    ? resolve(argumentsList[outputIndex + 1])
    : resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
try {
  const release = await buildRelease(pluginDirectory, {
    submission: argumentsList.includes('--submission'),
  });
  await mkdir(outputDirectory, { recursive: true });
  for (const [name, bytes] of Object.entries(release.archives)) {
    const outputPath = resolve(outputDirectory, name);
    await writeFile(outputPath, bytes);
    console.log(`${outputPath} (${bytes.length} bytes)`);
  }
  await writeFile(
    resolve(outputDirectory, `sendit-release-${release.version}.json`),
    `${JSON.stringify(release.report, null, 2)}\n`
  );
  for (const warning of release.warnings) console.log(`Preparation gap: ${warning}`);
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
