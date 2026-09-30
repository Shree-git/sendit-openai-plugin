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

The bridge package is `@senditapp/mcp`, with executable `sendit-mcp`.
It provides an MCP setup wizard and stdio bridge.
Use the verified `0.1.3` GitHub release while its npm registry update is pending.
This release fixes scoped-package installation and verifies API-key authentication with a read-only tool call.

```bash
npx -y --package=https://github.com/Shree-git/sendit-openai-plugin/releases/download/mcp-v0.1.3/senditapp-mcp-0.1.3.tgz sendit-mcp
```

The wizard uses a SendIt API key created in the SendIt dashboard.
Enter the key locally when prompted; do not paste it into a chat or commit it to a repository.
Check the package's `--help` output for supported clients.

To run its bridge from a shell that already has `SENDIT_API_KEY` set:

```bash
npx -y --package=https://github.com/Shree-git/sendit-openai-plugin/releases/download/mcp-v0.1.3/senditapp-mcp-0.1.3.tgz sendit-mcp serve
```

This process uses stdin and stdout for the MCP protocol and must be started by an MCP client.
Keep credentials in the user's private environment or secret manager.
Do not add credential-bearing headers to the distributed plugin's `mcp.json`.

## Install the standalone skill

The release's skill ZIP contains a `sendit/` directory with `SKILL.md`, references, and `agents/openai.yaml`.
For a local Codex install, extract that directory into `~/.agents/skills/` and open a new chat.
The YAML declares the remote MCP dependency; the user still completes OAuth in the host's supported connection flow.
For a host that does not install dependencies automatically, add and log in to the server using the commands above.
