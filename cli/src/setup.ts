/**
 * Interactive setup wizard.
 *
 * 1. Detect installed AI clients
 * 2. User selects which client to configure
 * 3. Prompt for API key (or open browser to get one)
 * 4. Write config file
 * 5. Verify connection
 */

import { detectClients, writeConfig, type ClientInfo } from './clients.js';
import { SENDIT_AUTH_URL, SENDIT_API_KEY_URL } from './constants.js';
import { ask, select, confirm } from './prompt.js';
import { verifyApiKey } from './verify.js';

function banner(): void {
  console.log();
  console.log('  ____                 _ ___ _   ');
  console.log(' / ___|  ___ _ __   __| |_ _| |_ ');
  console.log(" \\___ \\ / _ \\ '_ \\ / _` || || __|");
  console.log('  ___) |  __/ | | | (_| || || |_ ');
  console.log(' |____/ \\___|_| |_|\\__,_|___|\\__|');
  console.log();
  console.log(' One-Click MCP Installer');
  console.log(' Publish to social media from any AI assistant');
  console.log();
}

export async function runSetupWizard(): Promise<void> {
  banner();

  // 1. Detect clients
  const allClients = detectClients();
  const detectedClients = allClients.filter((c) => c.detected);

  if (detectedClients.length === 0) {
    console.log('No supported AI clients detected on this system.');
    console.log();
    console.log('Supported clients:');
    for (const c of allClients) {
      console.log(`  - ${c.name}`);
    }
    console.log();
    console.log('Install one of these clients, then run this installer again.');
    process.exit(1);
  }

  console.log(`Detected ${detectedClients.length} AI client(s):\n`);
  for (const c of detectedClients) {
    console.log(`  - ${c.name}`);
  }

  // 2. Select client
  let selectedClient: ClientInfo;
  if (detectedClients.length === 1) {
    selectedClient = detectedClients[0];
    const ok = await confirm(`Configure SendIt for ${selectedClient.name}?`);
    if (!ok) {
      console.log('Setup cancelled.');
      process.exit(0);
    }
  } else {
    const clientId = await select(
      'Which AI client do you want to configure?',
      detectedClients.map((c) => ({ value: c.id, name: c.name }))
    );
    selectedClient = detectedClients.find((c) => c.id === clientId)!;
  }

  // 3. Get API key
  console.log();
  console.log('You need a SendIt API key to continue.');
  console.log();

  const hasKey = await confirm('Do you already have an API key?', false);
  let apiKey: string;

  if (hasKey) {
    apiKey = await ask('Enter your API key (sk_live_...): ');
  } else {
    console.log();
    console.log('To get an API key:');
    console.log(`  1. Sign up or log in at: ${SENDIT_AUTH_URL}`);
    console.log(`  2. Go to Settings: ${SENDIT_API_KEY_URL}`);
    console.log(`  3. Create a new API key and copy it`);
    console.log();

    // Try to open browser
    try {
      const { exec } = await import('node:child_process');
      const openCmd =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'start'
            : 'xdg-open';
      exec(`${openCmd} ${SENDIT_AUTH_URL}`);
      console.log('(Opening browser...)');
    } catch {
      // Ignore if we can't open browser
    }

    console.log();
    apiKey = await ask('Paste your API key here (sk_live_...): ');
  }

  // Basic format validation
  if (!apiKey.startsWith('sk_live_')) {
    console.log();
    console.log('Warning: API key should start with "sk_live_". Proceeding anyway...');
  }

  // 4. Verify connection
  console.log();
  console.log('Verifying API key...');
  const verifyResult = await verifyApiKey(apiKey);

  if (!verifyResult.ok) {
    console.log(`  Verification failed: ${verifyResult.message}`);
    const proceed = await confirm('Continue with setup anyway?', false);
    if (!proceed) {
      console.log('Setup cancelled.');
      process.exit(1);
    }
  } else {
    console.log(`  ${verifyResult.message}`);
  }

  // 5. Write config
  console.log();
  console.log(`Writing config to: ${selectedClient.configPath}`);

  try {
    writeConfig(selectedClient.id, selectedClient.configPath, apiKey);
    console.log('  Config written successfully.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Failed to write config: ${msg}`);
    process.exit(1);
  }

  // 6. Success
  console.log();
  console.log('='.repeat(50));
  console.log();
  console.log(`  SendIt is now configured for ${selectedClient.name}!`);
  console.log();

  if (selectedClient.id === 'claude-desktop') {
    console.log('  Restart Claude Desktop to activate the SendIt MCP server.');
  } else if (selectedClient.id === 'claude-code') {
    console.log('  The SendIt MCP server will be available in your next Claude Code session.');
  } else if (selectedClient.id === 'vscode' || selectedClient.id === 'cursor') {
    console.log(`  Restart ${selectedClient.name} to activate the SendIt MCP server.`);
  } else if (selectedClient.id === 'windsurf') {
    console.log('  Restart Windsurf to activate the SendIt MCP server.');
  }

  console.log();
  console.log('  Available tools:');
  console.log('    - publish_content: Post to LinkedIn, Instagram, TikTok, Threads, X');
  console.log('    - schedule_content: Schedule posts for later');
  console.log('    - get_analytics: View post performance');
  console.log('    - list_connected_accounts: See connected social accounts');
  console.log('    - And 30+ more tools');
  console.log();
  console.log('  Get started by asking your AI assistant:');
  console.log('    "What can SendIt do?"');
  console.log();
}
