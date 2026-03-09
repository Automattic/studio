# MCP Integration Design

## Overview

Add a `studio mcp` subcommand to the Studio CLI that implements an MCP (Model Context Protocol) server over stdin/stdout. This lets Claude Desktop (or any MCP client) manage local WordPress sites directly.

There are two ways to connect Claude Desktop to the Studio MCP server:

**Option A — Manual config** (edit `claude_desktop_config.json` directly):
```json
{
  "mcpServers": {
    "studio": {
      "command": "studio",
      "args": ["mcp"]
    }
  }
}
```

**Option B — `.mcpb` drag-and-drop bundle** (see [MCP Bundle](#mcp-bundle) section below).

## Why build it into the CLI (not a separate package)

A [prototype exists](https://github.com/nightnei/wordpress-developer-mcp-server) as a standalone npm package. The core overengineering there is that it's a separate tool that shells out to `studio` as a child process. Building MCP into the CLI instead means:

- **No separate install** — users who have Studio already have the MCP server
- **No Node.js download** — runs with the same Node that ships with Studio
- **No subprocess overhead** — direct function calls instead of spawning `studio site list`
- **No drift** — MCP tools call the same `runCommand()` functions the CLI already uses

## Architecture

The `studio mcp` command starts a JSON-RPC 2.0 server over stdin/stdout using `@modelcontextprotocol/sdk`. It reuses existing CLI command handler functions directly — no subprocess spawning.

```
apps/cli/commands/mcp/
  index.ts        ← registers `studio mcp` yargs command, starts StdioServerTransport
  tools/
    sites.ts      ← wraps existing site runCommand() functions
    files.ts      ← fs read/write/list with path containment
    wp-cli.ts     ← passes through to existing wp command
    preview.ts    ← wraps existing preview commands
    auth.ts       ← wraps existing auth status command
```

Total new code: ~300–400 lines, mostly thin wrappers around already-existing functions.

## Dependency

Add `@modelcontextprotocol/sdk` to `apps/cli/package.json`. This single package handles all JSON-RPC framing, the MCP handshake (`initialize` / `initialized`), `tools/list` dispatch, and `tools/call` routing.

## Tools

15 tools across 5 categories:

### Sites (7)
| Tool | Description |
|------|-------------|
| `site_list` | List all local sites |
| `site_status` | Get site details (URL, credentials, PHP/WP versions) |
| `site_start` | Start a site |
| `site_stop` | Stop a site |
| `site_create` | Create a new site (supports WP version, PHP version) |
| `site_delete` | Delete a site |
| `site_set` | Modify site settings (domain, HTTPS, PHP/WP version, Xdebug) |

### File System (4)
| Tool | Description |
|------|-------------|
| `fs_list_dir` | List files in a directory |
| `fs_read_file` | Read a text file |
| `fs_write_file` | Create or overwrite a file |
| `fs_delete` | Delete a file or directory |

All file operations use path containment — paths must resolve inside the site root to prevent directory traversal.

### WP-CLI (1)
| Tool | Description |
|------|-------------|
| `wp` | Run arbitrary WP-CLI commands against a running site |

### Preview Sites (2)
| Tool | Description |
|------|-------------|
| `preview_list` | List previews for a site |
| `preview_create` | Create a shareable preview URL |

### Auth (1)
| Tool | Description |
|------|-------------|
| `auth_status` | Check WordPress.com login status |

## MCP Bundle

The `.mcpb` (MCP Bundle) format lets users install the Studio MCP server into Claude Desktop by dragging a single file — no terminal required.

### Structure

```
apps/cli/mcp-bundle/
  manifest.json       ← bundle metadata, tool declarations, entry point
  server/index.js     ← launcher: finds the Studio CLI and re-execs it
  icon.png            ← Studio app icon (1024×1024 PNG)
  .gitignore          ← excludes *.mcpb build artifacts
  .mcpbignore         ← excludes *.mcpb from mcpb pack input
```

The generated `.mcpb` file is a zip archive and is **not committed** — it lives in `apps/cli/dist/` alongside the built CLI.

### How the launcher works

`server/index.js` is a small Node script (no dependencies) that Claude Desktop executes using its own bundled Node.js. It searches for the Studio CLI in this order:

1. `../../dist/cli/main.js` relative to the bundle — picks up a **dev build** at `apps/cli/dist/cli/main.js` when the bundle is installed from this repo
2. `/Applications/Studio.app/Contents/Resources/cli/main.js` (macOS system install)
3. `~/Applications/Studio.app/...` (macOS user install)
4. `%ProgramFiles%\Studio\resources\cli\main.js` (Windows)
5. `%LOCALAPPDATA%\Programs\Studio\resources\cli\main.js` (Windows user install)

Once found, it re-execs `node [cli-path] mcp`, inheriting stdin/stdout/stderr for the JSON-RPC transport.

### Building

Requires [`@anthropic-ai/mcpb`](https://github.com/modelcontextprotocol/mcpb) CLI:

```bash
npm install -g @anthropic-ai/mcpb
```

Then from `apps/cli/`:

```bash
npm run mcp-bundle
# outputs: apps/cli/dist/wordpress-studio.mcpb
```

Or directly:

```bash
mcpb pack apps/cli/mcp-bundle apps/cli/dist/wordpress-studio.mcpb
```

### Installing

Drag `dist/wordpress-studio.mcpb` onto Claude Desktop (or use **File → Developer → Install Extension**). Claude Desktop unpacks the bundle and runs `server/index.js` on every session start.

### Debugging

MCP server logs are at `~/Library/Logs/Claude/mcp-server-WordPress Studio.log`. The most useful signals:

- **"Server transport closed unexpectedly"** — the process exited early; look for errors in the log above that line
- **"Using built-in Node.js"** — Claude Desktop found and started the bundle correctly
- **Studio not found** — the launcher writes to stderr before exiting; check the log

## What the prototype has that we can drop

| Prototype piece | Why drop it |
|---|---|
| Separate npm package + install.sh | Built into Studio CLI instead |
| Own Node.js download (~50MB) | Uses Studio's bundled Node |
| esbuild build pipeline | Uses Studio's existing Vite build |
| `studio://appdata` MCP resource | Nice-to-have; not essential for v1 |
| `studio_inspect_site` prompt | Claude handles site inspection naturally |
| `formatCliFailure()` error wrapper | Raw errors are sufficient; Claude interprets them |
| WP-CLI command string tokenizer | Prototype needed this because it received a free-form string; direct function calls accept an array |

## Minimal implementation sketch

```typescript
// apps/cli/commands/mcp/index.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerSiteTools } from './tools/sites';
import { registerFsTools } from './tools/files';
import { registerWpCliTool } from './tools/wp-cli';
import { registerPreviewTools } from './tools/preview';
import { registerAuthTools } from './tools/auth';

export function registerCommand(yargs) {
  yargs.command('mcp', 'Start MCP server (JSON-RPC over stdio)', {}, async () => {
    const server = new McpServer({ name: 'studio', version: '1.0.0' });
    registerSiteTools(server);
    registerFsTools(server);
    registerWpCliTool(server);
    registerPreviewTools(server);
    registerAuthTools(server);
    await server.connect(new StdioServerTransport());
  });
}
```

Each tool file wraps the corresponding `runCommand()` function already used by the CLI command. For example:

```typescript
// apps/cli/commands/mcp/tools/sites.ts
import { runCommand as runSiteList } from '../site/list';

server.tool('studio_site_list', {}, async () => {
  const sites = await runSiteList();
  return [{ type: 'text', text: JSON.stringify(sites) }];
});
```

## References

- Prototype: https://github.com/nightnei/wordpress-developer-mcp-server
- MCP SDK: https://github.com/modelcontextprotocol/typescript-sdk
- MCP spec: https://modelcontextprotocol.io
