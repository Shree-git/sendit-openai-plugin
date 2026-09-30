# Recover from SendIt failures

## Authentication

An MCP OAuth error means the SendIt connection needs the host's Connect or login flow.
Complete authorization in the browser, then retry a read such as `list_connected_accounts`.
Do not ask for an API key to repair the bundled OAuth connection.

A platform-specific reconnect requirement is separate from the SendIt MCP login.
Use `connect_platform` for the affected social account and recheck token health after consent.
Never assume `connected: true` proves the provider token still works.

## Media and validation

An upload session may be pending or expired.
Read its status and create a new session if needed rather than guessing the eventual URL.
Keep local paths out of publishing arguments.

If validation reports missing media, title, privacy, interaction settings, or consent, collect the missing input before writing.
TikTok settings are user choices; do not silently select privacy or agree to music or commercial-content declarations.
Do not remove required settings just to make a request pass.

## Partial or uncertain writes

Report success or failure separately for each requested platform.
Keep any returned post IDs and URLs so a follow-up can address the actual result.
Do not retry successful destinations after a partial failure.
After an ambiguous timeout, inspect available schedule state or returned post evidence before issuing another write.
If no verification method is available, explain that the write status is uncertain and ask how the user wants to proceed.

## Missing capabilities

The public plugin uses the scoped publishing profile.
If the requested operation is absent, explain the limit and use the broader endpoint only when the user wants that setup.
A server or tool listing alone does not prove authentication, posting permissions, or a public directory approval.
