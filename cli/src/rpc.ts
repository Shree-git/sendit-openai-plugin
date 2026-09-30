import { getMcpUrl, SENDIT_MCP_VERSION } from './constants.js';

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class SendItRpcError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

/** One remote MCP session per stdio connection or setup verification. */
export class SendItRpcClient {
  private sessionId?: string;
  private protocolVersion?: string;
  private requestId = 0;

  constructor(private readonly apiKey: string) {}

  async call(method: string, params: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    if (this.protocolVersion) headers['MCP-Protocol-Version'] = this.protocolVersion;

    const id = ++this.requestId;
    const res = await fetch(getMcpUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: AbortSignal.timeout(30_000),
    });

    const newSessionId = res.headers.get('mcp-session-id');
    if (newSessionId) this.sessionId = newSessionId;
    if (!res.ok) throw new SendItRpcError(`SendIt API returned status ${res.status}`, res.status);

    const json = (await res.json()) as JsonRpcResponse;
    if (json.error) throw new SendItRpcError(json.error.message || 'Unknown RPC error');
    if (json.jsonrpc !== '2.0' || json.id !== id || json.result === undefined) {
      throw new SendItRpcError('SendIt returned an invalid MCP response.');
    }
    return json.result;
  }

  async initialize(): Promise<void> {
    const result = (await this.call('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'sendit-mcp', version: SENDIT_MCP_VERSION },
    })) as { protocolVersion?: string; serverInfo?: { name?: string } } | null;
    if (!result?.protocolVersion || !result.serverInfo?.name) {
      throw new SendItRpcError('SendIt returned an invalid MCP initialization.');
    }
    this.protocolVersion = result.protocolVersion;
  }
}
