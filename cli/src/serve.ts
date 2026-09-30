/**
 * MCP stdio server that proxies tool calls to the SendIt HTTP API.
 *
 * This runs locally on the user's machine and communicates with the AI client
 * via stdio (stdin/stdout). All tool calls are forwarded to the remote
 * SendIt API, authenticated via the SENDIT_API_KEY env var.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { SENDIT_MCP_VERSION } from './constants.js';
import { SendItRpcClient } from './rpc.js';

export async function startServe(): Promise<void> {
  const apiKey = process.env.SENDIT_API_KEY;

  if (!apiKey) {
    console.error('[sendit-mcp] No SENDIT_API_KEY environment variable set.');
    console.error('');
    console.error('Run "npx @senditapp/mcp" to configure your AI client,');
    console.error('or set the SENDIT_API_KEY environment variable manually.');
    process.exit(1);
  }

  const remote = new SendItRpcClient(apiKey);

  // Initialize remote session
  try {
    await remote.initialize();
  } catch (err) {
    console.error(
      `[sendit-mcp] Failed to initialize remote session: ${err instanceof Error ? err.message : err}`
    );
    console.error('[sendit-mcp] Continuing in passthrough mode...');
  }

  const server = new Server(
    {
      name: 'sendit',
      version: SENDIT_MCP_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // List tools - forward to remote API
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const result = (await remote.call('tools/list', {})) as { tools: unknown[] };
    return result;
  });

  // Call tool - forward to remote API
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await remote.call('tools/call', { name, arguments: args ?? {} });
    return result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  });

  // List resources - forward to remote API
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const result = (await remote.call('resources/list', {})) as { resources: unknown[] };
    return result;
  });

  // Read resource - forward to remote API
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const result = await remote.call('resources/read', { uri });
    return result as { contents: unknown[] };
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[sendit-mcp] Server running on stdio');
  console.error('[sendit-mcp] Connected to SendIt API');
}
