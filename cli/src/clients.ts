/**
 * AI Client detection and configuration generators.
 *
 * Supports: Claude Desktop / Claude Code, VS Code (Copilot), Cursor, Windsurf
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { getMcpPackage } from './constants.js';

export interface ClientInfo {
  id: string;
  name: string;
  detected: boolean;
  configPath: string;
}

// ---------------------------------------------------------------------------
// Config path helpers
// ---------------------------------------------------------------------------

function claudeDesktopConfigPath(): string {
  const home = homedir();
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    return join(
      process.env.APPDATA || join(home, 'AppData', 'Roaming'),
      'Claude',
      'claude_desktop_config.json'
    );
  }
  // Linux
  return join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

function claudeCodeConfigPath(): string {
  const home = homedir();
  return join(home, '.claude', 'claude_code_config.json');
}

function vscodeSettingsPath(): string {
  const home = homedir();
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
  }
  if (process.platform === 'win32') {
    return join(
      process.env.APPDATA || join(home, 'AppData', 'Roaming'),
      'Code',
      'User',
      'settings.json'
    );
  }
  return join(home, '.config', 'Code', 'User', 'settings.json');
}

function cursorConfigPath(): string {
  const home = homedir();
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Cursor', 'User', 'settings.json');
  }
  if (process.platform === 'win32') {
    return join(
      process.env.APPDATA || join(home, 'AppData', 'Roaming'),
      'Cursor',
      'User',
      'settings.json'
    );
  }
  return join(home, '.config', 'Cursor', 'User', 'settings.json');
}

function windsurfConfigPath(): string {
  const home = homedir();
  return join(home, '.codeium', 'windsurf', 'mcp_config.json');
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function isInstalled(configPath: string): boolean {
  // Check if the config file itself exists, or its parent directory
  if (existsSync(configPath)) return true;
  const parentDir = dirname(configPath);
  return existsSync(parentDir);
}

export function detectClients(): ClientInfo[] {
  return [
    {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      detected: isInstalled(claudeDesktopConfigPath()),
      configPath: claudeDesktopConfigPath(),
    },
    {
      id: 'claude-code',
      name: 'Claude Code (CLI)',
      detected: existsSync(join(homedir(), '.claude')),
      configPath: claudeCodeConfigPath(),
    },
    {
      id: 'vscode',
      name: 'VS Code (Copilot)',
      detected: isInstalled(vscodeSettingsPath()),
      configPath: vscodeSettingsPath(),
    },
    {
      id: 'cursor',
      name: 'Cursor',
      detected: isInstalled(cursorConfigPath()),
      configPath: cursorConfigPath(),
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      detected: isInstalled(windsurfConfigPath()),
      configPath: windsurfConfigPath(),
    },
  ];
}

// ---------------------------------------------------------------------------
// Config writers
// ---------------------------------------------------------------------------

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

function writeJsonFile(path: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/** The MCP server entry used by all clients that support the mcpServers config format. */
function mcpServerEntry(apiKey: string) {
  return {
    command: 'npx',
    args: ['-y', `--package=${getMcpPackage()}`, 'sendit-mcp', 'serve'],
    env: { SENDIT_API_KEY: apiKey },
  };
}

export function writeConfig(clientId: string, configPath: string, apiKey: string): void {
  const config = readJsonFile(configPath);

  switch (clientId) {
    case 'claude-desktop': {
      // Claude Desktop uses { mcpServers: { sendit: { ... } } }
      const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
      servers['sendit'] = mcpServerEntry(apiKey);
      config.mcpServers = servers;
      writeJsonFile(configPath, config);
      break;
    }

    case 'claude-code': {
      // Claude Code uses { mcpServers: { sendit: { ... } } }
      const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
      servers['sendit'] = mcpServerEntry(apiKey);
      config.mcpServers = servers;
      writeJsonFile(configPath, config);
      break;
    }

    case 'vscode': {
      // VS Code uses settings.json: { "mcp": { "servers": { "sendit": { ... } } } }
      const mcp = (config['mcp'] ?? {}) as Record<string, unknown>;
      const servers = (mcp['servers'] ?? {}) as Record<string, unknown>;
      servers['sendit'] = mcpServerEntry(apiKey);
      mcp['servers'] = servers;
      config['mcp'] = mcp;
      writeJsonFile(configPath, config);
      break;
    }

    case 'cursor': {
      // Cursor uses same format as VS Code
      const mcp = (config['mcp'] ?? {}) as Record<string, unknown>;
      const servers = (mcp['servers'] ?? {}) as Record<string, unknown>;
      servers['sendit'] = mcpServerEntry(apiKey);
      mcp['servers'] = servers;
      config['mcp'] = mcp;
      writeJsonFile(configPath, config);
      break;
    }

    case 'windsurf': {
      // Windsurf uses { mcpServers: { sendit: { ... } } }
      const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
      servers['sendit'] = mcpServerEntry(apiKey);
      config.mcpServers = servers;
      writeJsonFile(configPath, config);
      break;
    }

    default:
      throw new Error(`Unknown client: ${clientId}`);
  }
}
