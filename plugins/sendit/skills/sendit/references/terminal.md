# Terminal and Codex setup

Prefer the bundled hosted OAuth connection when the plugin is installed.
This works without a local SendIt process or an API key in the skill.

## Direct remote MCP in Codex

For users who want MCP without installing the plugin, register the same scoped server:

```bash
codex mcp add sendit --url https://sendit.infiniteappsai.com/api/mcp/chatgpt
codex mcp login sendit
codex mcp list
```

Complete sign-in and consent in the browser opened by Codex.
Start a new chat after adding a connection, then ask SendIt to list connected accounts.
For the broader SendIt agent catalog, use `https://sendit.infiniteappsai.com/mcp` in place of the scoped endpoint and discover tools before use.

## Optional local stdio bridge

The published package is `@senditapp/mcp`, with executables `sendit-mcp` and `sendit`.
It provides an MCP setup wizard, terminal commands, and a stdio bridge.
Use the verified npm `0.2.1` release:

```bash
npx -y --package=@senditapp/mcp@0.2.1 sendit-mcp
```

The wizard uses a SendIt API key created in the SendIt dashboard.
Enter the key locally when prompted; do not paste it into a chat or commit it to a repository.
The wizard supports Claude Desktop, Claude Code, VS Code, Cursor, and Windsurf.
Its generated client entries use unversioned `@senditapp/mcp`, so future client launches can install a newer npm release.
To keep a specific release, configure the client manually with the pinned command below.

To run its bridge from a shell that already has `SENDIT_API_KEY` set:

```bash
npx -y --package=@senditapp/mcp@0.2.1 sendit-mcp serve
```

This process uses stdin and stdout for the MCP protocol and must be started by an MCP client.
For a host that accepts an `mcpServers` configuration, use this entry and supply `SENDIT_API_KEY` through the host's private environment or secret settings:

```json
{
  "mcpServers": {
    "sendit": {
      "command": "npx",
      "args": ["-y", "--package=@senditapp/mcp@0.2.1", "sendit-mcp", "serve"]
    }
  }
}
```

The bridge's default remote endpoint is `https://sendit.infiniteappsai.com/api/mcp`.
It provides the broader catalog; discover tools before using capabilities beyond the bundled plugin profile.
Set `SENDIT_MCP_URL` to select another verified deployment or the scoped `https://sendit.infiniteappsai.com/api/mcp/chatgpt` profile.
Keep credentials in the user's private environment or secret manager.
Do not add credential-bearing headers to the distributed plugin's `mcp.json`.

## Terminal commands

Use the top-level help and version flags:

```bash
npx -y --package=@senditapp/mcp@0.2.1 sendit-mcp --help
npx -y --package=@senditapp/mcp@0.2.1 sendit-mcp --version
npx -y --package=@senditapp/mcp@0.2.1 sendit-mcp tools
```

`tools` performs public discovery and returns the catalog as JSON, including all pages.
Public discovery does not verify an API key.
With `SENDIT_API_KEY` already supplied privately, verify authentication or make a read-only call:

```bash
npx -y --package=@senditapp/mcp@0.2.1 sendit-mcp verify
npx -y --package=@senditapp/mcp@0.2.1 sendit-mcp call get_platform_requirements '{"platform":"linkedin"}'
```

`verify` requires a successful authenticated read-only tool call.
`call` accepts a JSON object as its final argument or from stdin.
Choose tools and write arguments only for the user's authorized action.
Failures, including tool results marked `isError`, return a nonzero exit status.

## Legacy bridge

Users retaining CLI `0.1.3` can still use its immutable GitHub release:

```bash
npx -y --package=https://github.com/Shree-git/sendit-openai-plugin/releases/download/mcp-v0.1.3/senditapp-mcp-0.1.3.tgz sendit-mcp serve
```

This older release provides the setup wizard and stdio bridge.
The terminal commands described above require `0.2.1`.

## Install the standalone skill

The release's skill ZIP contains a `sendit/` directory with `SKILL.md`, references, and `agents/openai.yaml`.
For a local Codex install, extract that directory into `~/.agents/skills/` and open a new chat.
The YAML declares the remote MCP dependency; the user still completes OAuth in the host's supported connection flow.
For a host that does not install dependencies automatically, add and log in to the server using the commands above.
