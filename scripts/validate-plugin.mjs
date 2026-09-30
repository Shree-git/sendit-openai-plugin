#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defaultPluginDirectory, validateArchive, validateDirectory } from './package-tools.mjs';

const argumentsList = process.argv.slice(2);
const options = {
  submission: argumentsList.includes('--submission'),
  online: argumentsList.includes('--online'),
};
const pathIndex = argumentsList.indexOf('--path');
const archiveIndex = argumentsList.indexOf('--archive');
try {
  const result =
    archiveIndex >= 0
      ? await validateArchive(await readFile(resolve(argumentsList[archiveIndex + 1])), options)
      : await validateDirectory(
          pathIndex >= 0 ? resolve(argumentsList[pathIndex + 1]) : defaultPluginDirectory,
          options
        );
  for (const warning of result.warnings) console.log(`Preparation gap: ${warning}`);
  if (result.errors.length) {
    for (const error of result.errors) console.error(`Error: ${error}`);
    process.exitCode = 1;
  } else {
    console.log(
      `SendIt ${options.submission ? 'submission metadata' : 'package'} validation passed (${result.files.length} files, ${result.skills.length} skills).`
    );
    if (options.submission)
      console.log(
        'Portal authentication, reviewer access, scans, policy attestations, and approval remain separate checks.'
      );
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
