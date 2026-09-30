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
import { SENDIT_MCP_VERSION } from './constants.js';
import { startServe } from './serve.js';
import { runSetupWizard } from './setup.js';

const usage = `SendIt MCP CLI ${SENDIT_MCP_VERSION}

Usage:
  sendit-mcp [setup]
  sendit-mcp serve
  sendit-mcp --help
  sendit-mcp --version

Commands:
  setup       Run the interactive setup wizard (default).
  serve       Start the MCP stdio bridge for an AI client.
  help        Show this usage information.

Options:
  -h, --help     Show help without starting setup.
  -v, --version  Print the CLI version.

Supported clients:
  Claude Desktop, Claude Code, VS Code (Copilot), Cursor, Windsurf.

Setup verifies your API key before writing client configuration.`;

function main(): void {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs({
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
    const command = args.positionals[0];
    if (args.positionals.length > 1) throw new Error('Expected at most one command.');
    if (command !== undefined && !['setup', 'serve', 'help'].includes(command)) {
      throw new Error(`Unknown command: ${command}`);
    }
    if (args.values.help || command === 'help') {
      console.log(usage);
    } else if (args.values.version) {
      console.log(SENDIT_MCP_VERSION);
    } else if (command === 'serve') {
      void startServe();
    } else {
      void runSetupWizard();
    }
  } catch (error) {
    console.error(`[SendIt] ${error instanceof Error ? error.message : String(error)}`);
    console.error(usage);
    process.exitCode = 1;
  }
}

main();
