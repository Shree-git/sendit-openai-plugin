# SendIt plugin for ChatGPT and Codex

Connect social accounts, check and preview drafts, publish approved posts, schedule content, and read analytics with [SendIt](https://sendit.infiniteappsai.com).
The package includes one skill and SendIt's hosted MCP profile for LinkedIn, Instagram, Threads, TikTok, X, Facebook, YouTube, and Pinterest.

This repository distributes the plugin source and downloadable releases publicly.
Publication in OpenAI's shared Plugins Directory requires a separate review and approval.
SendIt's existing directory submission is not published.

The [recorded ChatGPT reviewer walkthrough](https://shree-git.github.io/sendit-openai-plugin/) covers account status, draft validation, full LinkedIn and Threads previews, missing-media guidance, and capability boundaries.
Publishing and scheduling review cases were not run because the creator requested draft checks only.

## Install in Codex

Add the public repository as a plugin marketplace:

```bash
codex plugin marketplace add Shree-git/sendit-openai-plugin
codex plugin add sendit@sendit-plugins
```

These commands are supported by the current Codex CLI.
If your CLI has no `plugin add` command, update Codex or open `/plugins` in Codex and install SendIt from the `SendIt plugins` marketplace.
Complete the host's SendIt OAuth connection flow and start a new chat.

Try:

```text
Use SendIt to show my connected social accounts and any accounts that need reconnecting.
```

For local source testing:

```bash
codex plugin marketplace add /absolute/path/to/sendit-openai-plugin
codex plugin add sendit@sendit-plugins
```

## Use in ChatGPT

For development, enable Developer mode under Settings, Security and login.
Create a connection from the [Plugins page](https://chatgpt.com/plugins) using OAuth and this MCP URL:

```text
https://sendit.infiniteappsai.com/api/mcp/chatgpt
```

The server supports Streamable HTTP and OAuth discovery with PKCE.
After connection, ask SendIt to list connected accounts and validate a draft.
In ChatGPT Work or a supported desktop client, use the local marketplace or the release's skill bundle for workflow instructions.
Public directory installation will be available only after OpenAI approves and publishes the plugin.
Client support for repository marketplaces differs by surface; see [OpenAI's packaging guide](https://developers.openai.com/plugins/build/plugins).

## Use MCP without the plugin

```bash
codex mcp add sendit --url https://sendit.infiniteappsai.com/api/mcp/chatgpt
codex mcp login sendit
```

The broader agent endpoint is `https://sendit.infiniteappsai.com/mcp`.
Discover its catalog before using capabilities beyond the scoped public profile.

## Optional terminal bridge

```bash
npx -y --package=@senditapp/mcp@0.2.1 sendit-mcp
```

The published npm `0.2.1` CLI provides the `sendit-mcp` setup wizard, terminal commands, and a stdio bridge.
This exact version was checked with fresh registry installation, authenticated read-only verification against a local fixture, and actual stdio tool and resource calls.
CLI source and tests are in [SendIt agent integrations](https://github.com/Shree-git/sendit-agent-integrations/tree/main/cli).
The hosted plugin uses OAuth; the optional terminal bridge uses a SendIt API key entered locally.
The wizard writes client configurations that use unversioned `@senditapp/mcp`, so subsequent client launches can use a newer npm release.
For an explicit version pin, use the manual stdio configuration in the [terminal setup guide](plugins/sendit/skills/sendit/references/terminal.md).
The earlier immutable [GitHub CLI 0.1.3 release](https://github.com/Shree-git/sendit-openai-plugin/releases/tag/mcp-v0.1.3) remains available for users retaining that version.

## Releases

Download the plugin ZIP or standalone skill ZIP from [GitHub Releases](https://github.com/Shree-git/sendit-openai-plugin/releases).
The plugin ZIP includes `sendit/plugin.json`, `mcp.json`, the skill, logo, and license.
The standalone skill ZIP includes `sendit/SKILL.md`, its references, and `agents/openai.yaml`.
Extract the skill into `~/.agents/skills/` for a local Codex skill install and complete MCP OAuth separately if the host does not install the declared dependency.

The plugin ZIP contains no API keys, private app bindings, reviewer passwords, lifecycle hooks, or local executables.
The optional CLI is distributed separately as an npm-compatible tarball.

## Build and check

Use Node.js 20 or later:

```bash
npm ci
npm test
npm run build
npm run validate:submission
```

The normal build checks package structure and the actual ZIP inventory.
Submission validation also checks review readiness and fails when required review materials, such as an accessible demo recording, are absent.
A valid package or successful install does not prove directory approval.

## Support and policies

Get help from [SendIt support](https://sendit.infiniteappsai.com/support).
Review [privacy](https://sendit.infiniteappsai.com/privacy) and [terms](https://sendit.infiniteappsai.com/terms).
SendIt account permissions, platform permissions, and plan limits determine which actions are available.
Explicit user instructions take priority over the skill's defaults.

## License

MIT, with the license retained in each release bundle.
