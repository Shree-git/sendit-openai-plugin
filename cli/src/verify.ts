/** Verify API-key authentication using a read-only MCP tool call. */
import { SendItRpcClient, SendItRpcError } from './rpc.js';

export interface VerifyResult {
  ok: boolean;
  message: string;
}

export async function verifyApiKey(apiKey: string): Promise<VerifyResult> {
  try {
    const remote = new SendItRpcClient(apiKey);
    await remote.initialize();
    // Discovery is public. A read-only tool call is required to prove the key authenticates.
    const result = (await remote.call('tools/call', {
      name: 'get_platform_requirements',
      arguments: { platform: 'linkedin' },
    })) as { content?: unknown[]; isError?: boolean } | null;
    if (!Array.isArray(result?.content) || result.isError) {
      return { ok: false, message: 'SendIt could not complete the authenticated verification.' };
    }
    return { ok: true, message: 'API key verified successfully.' };
  } catch (err) {
    if (err instanceof SendItRpcError && (err.status === 401 || err.status === 403)) {
      return { ok: false, message: 'Invalid API key. Please check your key and try again.' };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Could not verify SendIt API key: ${msg}` };
  }
}
