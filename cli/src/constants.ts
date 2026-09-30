export const SENDIT_API_BASE = 'https://sendit.infiniteappsai.com';
export const SENDIT_API_KEY_URL = `${SENDIT_API_BASE}/dashboard/settings`;
export const SENDIT_AUTH_URL = `${SENDIT_API_BASE}/login`;
export const SENDIT_MCP_PACKAGE = '@senditapp/mcp';
export const SENDIT_MCP_VERSION = '0.1.3';
export const SENDIT_MCP_RELEASE_URL = `https://github.com/Shree-git/sendit-openai-plugin/releases/download/mcp-v${SENDIT_MCP_VERSION}/senditapp-mcp-${SENDIT_MCP_VERSION}.tgz`;

/** Use the repaired public release while retaining an explicit distribution override. */
export function getMcpPackage(): string {
  const value = process.env.SENDIT_MCP_PACKAGE;
  if (value === undefined) return SENDIT_MCP_RELEASE_URL;
  if (!value || /\s/.test(value)) {
    throw new Error('SENDIT_MCP_PACKAGE must be a nonblank npm package spec or HTTPS tarball URL.');
  }
  if (value.startsWith('https://')) {
    try {
      const url = new URL(value);
      if (
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        /\.(?:tgz|tar\.gz)$/.test(url.pathname)
      )
        return value;
    } catch {
      // Report the same actionable validation error as unsupported URL forms.
    }
  } else if (
    /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[~^]?[A-Za-z0-9][A-Za-z0-9.+_-]*)?$/.test(
      value
    )
  ) {
    return value;
  }
  throw new Error(
    'SENDIT_MCP_PACKAGE must be an npm package spec or HTTPS .tgz/.tar.gz URL without credentials, query, or fragment.'
  );
}

/** Override the remote endpoint for self-hosted deployments and local acceptance tests. */
export function getMcpUrl(): string {
  return process.env.SENDIT_MCP_URL || `${SENDIT_API_BASE}/api/mcp`;
}
