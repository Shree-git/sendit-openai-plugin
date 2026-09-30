# SendIt tool reference

Discover the installed tool schema before calling a tool.
Tool names below omit the prefix supplied by ChatGPT or Codex.

| Goal | Tool | Inputs and result |
| --- | --- | --- |
| Check accounts | `list_connected_accounts` | Reads connected accounts and token health; optional `team_id` if the user supplied the team context. |
| Connect an account | `connect_platform` | Takes a supported `platform` and returns provider connection instructions. |
| Check platform limits | `get_platform_requirements` | Takes `platform`; returns current content requirements and settings. |
| Check a draft | `validate_content` | Takes `platforms` and `content` with required `text`; returns errors and warnings per platform. |
| Preview a draft | `preview_content` | Takes `platforms` and `content`; returns a visual preview and validation details. |
| Upload a local file | `create_upload_session` | Creates a browser upload link; use the advertised schema for optional media settings. |
| Check an upload | `get_upload_session` | Takes the returned session ID and returns pending, completed, or expired status and media URLs. |
| Publish | `publish_content` | Takes `platforms` and approved `content`; returns actual results per platform. |
| Schedule | `schedule_content` | Takes `platforms`, approved `content`, and the future timestamp from its schema; returns a schedule ID. |
| List schedules | `get_scheduled_posts` | Reads matching schedules and their statuses; use returned IDs for later actions. |
| Cancel a schedule | `delete_scheduled_post` | Cancels the specified pending schedule. |
| Publish a schedule now | `trigger_scheduled_post` | Immediately publishes the specified pending schedule. |
| Delete a published post | `delete_post` | Deletes the identified post where the platform permits it. |
| Read metrics | `get_analytics` | Takes the requested platform and supported date-range options; returns metrics and availability warnings. |

## Content shape

Use `content.text` for the exact approved caption or post text.
Use `content.mediaUrl` for one uploaded public HTTPS URL or `content.mediaUrls` for a supported carousel.
Use `content.mediaType` when the format needs an explicit image or video hint.
Load the tool schema for title, description, board targeting, and per-platform settings.
Do not copy settings from one platform into another without checking the requirements.

The bundled profile has no `list_teams` tool.
Ask for a known team context or use personal accounts; do not fabricate a team ID or assume a broader tool exists.
Other SendIt endpoints expose additional platforms and operations, so discover their catalog before expanding a workflow.
