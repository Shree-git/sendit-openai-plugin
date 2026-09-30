# sendit-mcp

One-click MCP server installer for [SendIt](https://sendit.infiniteappsai.com) - publish to social media from any AI assistant.

## Quick Start

```bash
npx -y --package=https://github.com/Shree-git/sendit-openai-plugin/releases/download/mcp-v0.1.3/senditapp-mcp-0.1.3.tgz sendit-mcp
```

The repaired `0.1.3` package is distributed through [GitHub Releases](https://github.com/Shree-git/sendit-openai-plugin/releases/tag/mcp-v0.1.3).
The npm registry currently serves the older `0.1.1` version while npm publishing access is being repaired.
The wizard pins generated client configurations to the same GitHub release so they run the repaired executable.

The interactive wizard will:

1. Detect your installed AI clients (Claude Desktop, VS Code, Cursor, Windsurf)
2. Ask for your SendIt API key
3. Write the correct config file
4. Verify the connection works

## Supported Clients

| Client            | Config Format                |
| ----------------- | ---------------------------- |
| Claude Desktop    | `claude_desktop_config.json` |
| Claude Code       | `claude_code_config.json`    |
| VS Code (Copilot) | `settings.json`              |
| Cursor            | `settings.json`              |
| Windsurf          | `mcp_config.json`            |

## Manual Setup

If you prefer to configure manually, add this to your AI client's MCP config:

```json
{
  "mcpServers": {
    "sendit": {
      "command": "npx",
      "args": [
        "-y",
        "--package=https://github.com/Shree-git/sendit-openai-plugin/releases/download/mcp-v0.1.3/senditapp-mcp-0.1.3.tgz",
        "sendit-mcp",
        "serve"
      ],
      "env": {
        "SENDIT_API_KEY": "sk_live_YOUR_KEY_HERE"
      }
    }
  }
}
```

## Commands

### `sendit-mcp --help` or `sendit-mcp help`

Show usage, commands, and supported clients without starting the setup wizard.
The short form is `-h`.

### `sendit-mcp --version`

Print the installed CLI version without starting setup.
The short form is `-v`.
Unknown commands and options exit with an error and usage information.

### `sendit-mcp`

Interactive setup wizard.
The wizard verifies API-key authentication using a read-only tool call before writing configuration.

### `sendit-mcp serve`

Start the MCP stdio server.
AI clients run this command to communicate with SendIt.
It is invoked automatically by your AI client.

The remote endpoint defaults to `https://sendit.infiniteappsai.com/api/mcp`.
Set `SENDIT_MCP_URL` for a self-hosted deployment or local development.
For the public OpenAI plugin, skill, and OAuth setup, use [SendIt's public plugin repository](https://github.com/Shree-git/sendit-openai-plugin).

## Custom package distribution

Set `SENDIT_MCP_PACKAGE` before running the wizard to generate configurations for an explicit npm package spec or a self-hosted HTTPS `.tgz` or `.tar.gz` URL.
The package must expose the `sendit-mcp` executable.
For example, a private registry can use `@your-team/sendit-mcp@0.1.3`, with registry authentication configured locally in npm.
Tarball URLs must not contain embedded credentials, query parameters, fragments, or whitespace.
The default remains the pinned public GitHub release when this override is absent.

## Getting an API Key

1. Sign up at [sendit.infiniteappsai.com/login](https://sendit.infiniteappsai.com/login)
2. Go to Settings in the dashboard
3. Create a new API key

## Available Tools

Once configured, your AI assistant can:

- **publish_content** - Post to LinkedIn, Instagram, TikTok, Threads, X, Facebook, YouTube, Pinterest
- **schedule_content** - Schedule posts for later
- **get_analytics** - View post performance metrics
- **list_connected_accounts** - See connected social accounts
- **upload_media** - Upload images and videos
- And the full SendIt MCP tool catalog

Ask your AI assistant "What can SendIt do?" to get started.

## License

MIT
