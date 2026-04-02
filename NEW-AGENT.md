# Tasks & AI Agent

This branch adds AI-powered Tasks to Studio. A Task is a chat session with a Claude agent, tied to a WordPress site. Users can create tasks from the sidebar or site overview, chat with the agent, and the agent can manage their site via MCP tools and file operations.

## Status

**Proof of Concept** — The full pipeline is functional: task creation, sidebar navigation, chat UI, agent integration via the Claude Agent SDK in the Electron main process, and desktop-native MCP tools (site_list, site_info, site_start, site_stop, wp_cli). Tasks persist across app restarts. Permission prompts for filesystem operations outside the site directory are wired but not yet polished.

## Architecture

### Agent Execution Model

The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) runs directly in the Electron main process. The SDK internally spawns its own subprocess (a bundled Claude Code CLI), so there's no double-nesting of child processes. The desktop app passes `pathToClaudeCodeExecutable` explicitly because Vite bundling breaks the SDK's internal path resolution.

```
Renderer (React)                    Main Process (Node.js)
  |                                    |
  |-- ipcApi.startTaskAgentHandler --->|-- query({ prompt, mcpServers, ... })
  |                                    |     SDK spawns its own subprocess
  |<-- 'task-message' events ----------|-- for await (msg of query) {
  |<-- 'task-message' events ----------|     sendIpcEventToRenderer('task-message', msg)
  |                                    |   }
  |-- ipcApi.interruptTaskHandler ---->|-- query.interrupt()
```

### Provider Resolution

Authentication mirrors the CLI's provider fallback chain (`provider-resolver.ts`):

1. **WordPress.com** — Uses the shared auth token from `readSharedConfig()`. Proxies through the wpcom AI gateway.
2. **Anthropic Claude auth** — Checks for local Claude Code authentication via `claude auth status`.
3. **Anthropic API key** — Direct API key (not yet wired to UI for input).

### MCP Tools (Desktop-Native)

The agent has access to 12 Studio tools via an MCP server (`tools.ts`), all using `SiteServer` directly (not the CLI daemon):

- **site_list** — Lists all sites with status, paths, URLs.
- **site_info** — Detailed info for a specific site (path, URL, credentials, PHP version).
- **site_start** / **site_stop** — Start or stop a site's server.
- **wp_cli** — Execute WP-CLI commands on a running site (plugin install, post create, etc.).
- **post_blocks_read** — List all Gutenberg blocks in a post/page with indices, types, attributes, and content previews. Uses WordPress's `parse_blocks()` via `wp eval`.
- **post_block_update** — Replace a specific block by index with new block markup. Uses `parse_blocks()` / `serialize_blocks()` / `wp_update_post()` via `wp eval`. Markup is base64-encoded to avoid escaping issues.
- **browser_navigate** — Navigate the site preview browser to a URL or path. Syncs the visible preview iframe.
- **browser_reload** — Reload the current page. Syncs the visible preview iframe.
- **browser_screenshot** — Take a PNG screenshot via a hidden BrowserWindow's `webContents.capturePage()`. Returns an MCP image content block.
- **browser_read_page** — Read page title, URL, text content, and a structural DOM outline (headings, links, forms, buttons).
- **browser_console** — Read recent console messages (log/warning/error) with optional clear.

The browser tools use a `BrowserInspector` singleton (`browser-inspector.ts`) that manages hidden `BrowserWindow` instances per site. See `NEW-BROWSER.md` for details on the architecture.

The agent also has Claude Code's built-in file tools (Read, Write, Edit, Glob, Grep, Bash) for direct file manipulation. The agent's `cwd` is set to the task's site path so file operations work relative to the site.

### Permission Model

Read-only tools (Read, Glob, Grep, MCP tools) are auto-approved. Write operations (Write, Edit, Bash) within the site directory or temp directories are auto-approved. Write operations outside trusted roots trigger a permission prompt:

1. Main process `canUseTool` callback creates a pending Promise
2. Sends `task-permission-request` IPC event to renderer
3. Renderer shows inline permission dialog (Allow once / Allow for session / Deny)
4. User's response resolves the Promise via `respondToPermissionRequestHandler` IPC

Session-level approvals are cached per tool name so the user isn't prompted repeatedly.

### Data Model

**TaskMetadata** (persisted in `appdata-v1.json` alongside site data):

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID |
| `siteId` | `string` | Associated site ID |
| `title` | `string` | Auto-generated from first message |
| `status` | `'in-progress' \| 'waiting' \| 'done'` | Current state |
| `archived` | `boolean` | Hidden from sidebar when true |
| `createdAt` | `number` | Timestamp |
| `updatedAt` | `number` | Timestamp |
| `sessionId` | `string?` | SDK session ID for resuming conversations |

**TaskMessage** (persisted to `localStorage` via Redux listener, survives app restarts):

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Message ID (from SDK UUID or generated) |
| `role` | `'user' \| 'assistant' \| 'tool' \| 'system'` | Message type |
| `content` | `string` | Text content |
| `toolName` | `string?` | Tool name for tool-type messages |
| `toolInput` | `unknown?` | Tool input parameters |
| `toolResult` | `string?` | Tool execution result |
| `isStreaming` | `boolean?` | Currently being streamed |
| `isError` | `boolean?` | Error message |

### Navigation State

Task selection lives in Redux (`tasks-slice.ts`) via `selectedTaskId`. This is separate from site selection (which uses `useSiteDetails` context). The two are mutually exclusive in the UI:

- Clicking a task sets `selectedTaskId`, primary panel shows `TaskChatPanel`
- Clicking a site clears `selectedTaskId`, primary panel shows `SiteContentTabs`
- Site list items check `selectedTaskId` to suppress their highlight when a task is active

### System Prompt

The agent uses the full CLI system prompt from `tools/common/ai/system-prompt.ts` (shared between CLI and desktop). This includes detailed workflow steps, design guidelines, block content rules, and all tool descriptions. The desktop app appends site-specific context (site name, path, instructions to use wp_cli for content and check revisions).

### Message Serialization

SDK messages (`SDKMessage` union type) are converted to flat `TaskMessage` objects by `message-serializer.ts`. The serializer handles:

- `assistant` messages — extracts text content and tool use blocks
- `user` messages (synthetic) — extracts tool result content blocks with `tool_use_id` matching
- `result` messages — surfaces error messages only (successful results are already shown via the preceding `assistant` message)
- `tool_use_summary` — shows tool execution summaries
- `tool_progress` — shows tool running indicators

Tool results are merged back onto their invocation message in Redux by matching `tool_use_id`, so each tool call appears as a single expandable card with both input and output.

Other SDK message types (system/init, stream events, auth status) are filtered out.

### Redux State

The `tasks` slice (`tasks-slice.ts`) manages:

- `tasks: TaskMetadata[]` — All task metadata, loaded from IPC on app init
- `selectedTaskId: string | null` — Currently viewed task
- `messagesByTask: Record<string, TaskMessage[]>` — Chat messages per task
- `streamingByTask: Record<string, boolean>` — Per-task streaming indicator
- `pendingPermissions: PermissionRequest[]` — Pending permission dialogs

IPC event listeners in `stores/index.ts` dispatch actions for `task-updated`, `task-deleted`, `task-message`, `task-status-changed`, `task-permission-request`, and `task-error` events from the main process.

## UI Components

### Sidebar Task List

The sidebar's Tasks section (`tasks/task-list.tsx`) replaces the former placeholder:

- Header with "Tasks" label, archive toggle, and `+` button for creating new tasks
- Clicking `+` enters a "pending new task" state — the primary panel shows a site picker dropdown ("A new task for... [choose a site]") instead of an inline sidebar picker
- Task items show title, site name, and a status dot (blue pulsing = in-progress, gray = waiting, green = done)
- Archive button appears when hovering the status dot (not the whole row), replacing the dot
- Non-archived tasks sorted by `updatedAt` descending
- Archive toggle opens a Popover flyout listing archived tasks with count and "Clear all" button

### Chat Panel

When a task is selected, the primary panel renders `TaskChatPanel` instead of `SiteContentTabs`:

- **Message list** — User messages (right-aligned, themed), assistant messages (left-aligned, surface background), tool messages as expandable cards showing tool name with status dot, click to reveal full input (JSON) and output
- **Auto-scroll** — Scrolls to bottom on new messages
- **Streaming indicator** — Bouncing dots while agent is responding
- **Permission prompt** — Inline amber dialog above the input when the agent needs filesystem approval
- **Input** — Textarea with Enter-to-send (Shift+Enter for newlines), disabled during streaming

### Site Overview Integration

The site overview tab includes a "New task" button in the shortcuts section that creates a task pre-bound to that site.

## IPC Interface

### Handlers (invoke-style, return values)

| Handler | Description |
|---------|-------------|
| `createTask(siteId)` | Create task metadata, returns `TaskMetadata` |
| `getAllTasks()` | Returns all tasks |
| `updateTask(taskId, updates)` | Partial update (title, status, archived, sessionId) |
| `archiveTask(taskId)` | Set archived=true |
| `deleteTask(taskId)` | Remove from appdata |
| `clearArchivedTasks()` | Delete all archived tasks, returns removed IDs |
| `updateTaskStatus(taskId, status)` | Update status field |
| `startTaskAgentHandler(taskId, prompt, resumeSessionId?)` | Start agent session |
| `sendTaskMessageHandler(taskId, message)` | Send follow-up message |
| `interruptTaskHandler(taskId)` | Interrupt active agent |
| `respondToPermissionRequestHandler(requestId, response, taskId?)` | Resolve permission |

### Events (main -> renderer)

| Event | Payload | Description |
|-------|---------|-------------|
| `task-updated` | `TaskMetadata` | Task metadata changed |
| `task-deleted` | `string` (taskId) | Task removed |
| `task-message` | `{ taskId, message: TaskMessage }` | New chat message |
| `task-status-changed` | `{ taskId, status }` | Agent status transition |
| `task-permission-request` | `PermissionRequest` | Agent needs user approval |
| `task-error` | `{ taskId, error }` | Agent error |
| `browser-navigate` | `{ siteId, url }` | Agent navigated the browser (syncs preview iframe) |

## Key Files

```
apps/studio/src/
├── modules/ai/
│   ├── types.ts                        # TaskMetadata, TaskMessage, PermissionRequest
│   └── lib/
│       ├── ipc-handlers.ts             # Task CRUD + agent lifecycle handlers
│       ├── agent-manager.ts            # Active Query management, message loop, permissions
│       ├── tools.ts                    # Desktop MCP tools (site_list, wp_cli, etc.)
│       ├── browser-inspector.ts        # Hidden BrowserWindow manager for agent inspection
│       ├── browser-tools.ts            # Browser MCP tools (navigate, screenshot, etc.)
│       ├── provider-resolver.ts        # Auth provider fallback (wpcom/claude/api-key)
│       └── message-serializer.ts       # SDKMessage -> TaskMessage conversion
├── components/site-menu.tsx                # Updated: clears task selection on site click
├── stores/
│   └── tasks-slice.ts                  # Redux state for tasks, messages, permissions
├── components/new-ui/tasks/
│   ├── task-list.tsx                   # Sidebar task list with + button and archive flyout
│   ├── task-list-item.tsx              # Individual task item with status dot
│   ├── task-new-panel.tsx              # New task site picker (primary panel)
│   ├── task-chat-panel.tsx             # Chat panel (primary panel replacement)
│   ├── task-chat-input.tsx             # Message input with agent IPC
│   ├── task-message-list.tsx           # Message bubbles (user/assistant/tool)
│   └── task-permission-prompt.tsx      # Inline permission dialog
├── storage/storage-types.ts            # UserData.tasks field added
├── ipc-handlers.ts                     # Re-exports task handlers
├── ipc-utils.ts                        # Task IPC event types
├── preload.ts                          # Task IPC bridge methods
└── stores/index.ts                     # Tasks reducer + IPC event listeners

tools/common/ai/
└── system-prompt.ts                    # Shared system prompt (used by CLI and desktop)

apps/cli/ai/
└── system-prompt.ts                    # Re-exports from tools/common/ai/
```

## What's Next

- Session resume on app restart (sessionId is persisted, `query({ resume })` is wired)
- More MCP tools (site_create, site_delete, preview_create/update/delete, validate_blocks)
- Markdown rendering in assistant messages
- Streaming partial text (SDKPartialAssistantMessage events)
- Auto-title refinement (use agent to generate a better title after first exchange)
- Error recovery UI (provider not available, rate limits, etc.)
- Keyboard shortcuts (Escape to interrupt, etc.)
