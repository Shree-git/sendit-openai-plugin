#!/usr/bin/env node

/**
 * SendIt MCP CLI
 *
 * One-click installer and server for SendIt's MCP integration.
 *
 * Usage:
 *   sendit-mcp          # Interactive setup wizard
 *   sendit-mcp serve    # Start MCP stdio server (used by AI clients)
 */

import { parseArgs } from 'node:util';
import { startServe } from './serve.js';
import { runSetupWizard } from './setup.js';

const { positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
});

const command = positionals[0];

if (command === 'serve') {
  startServe();
} else {
  runSetupWizard();
}
