# MCP Integration Design

## Overview

Add a `studio mcp` subcommand to the Studio CLI that implements an MCP (Model Context Protocol) server over stdin/stdout. This lets Claude Desktop (or any MCP client) manage local WordPress sites directly.

**Claude Desktop config:**
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

18 tools across 5 categories — matching the prototype's scope:

### Sites (7)
| Tool | Description |
|------|-------------|
| `studio_site_list` | List all local sites |
| `studio_site_status` | Get site details (URL, credentials, PHP/WP versions) |
| `studio_site_start` | Start a site |
| `studio_site_stop` | Stop a site |
| `studio_site_create` | Create a new site (supports WP version, PHP version, Blueprints) |
| `studio_site_delete` | Delete a site (requires `confirm: true`) |
| `studio_site_set` | Modify site settings (domain, HTTPS, PHP/WP version, Xdebug) |

### File System (4)
| Tool | Description |
|------|-------------|
| `studio_fs_list_dir` | List files in a directory |
| `studio_fs_read_file` | Read a text file (size-limited) |
| `studio_fs_write_file` | Create or overwrite a file |
| `studio_fs_delete` | Delete a file or directory |

All file operations use path containment — paths must resolve inside the site root to prevent directory traversal.

### WP-CLI (1)
| Tool | Description |
|------|-------------|
| `studio_wp` | Run arbitrary WP-CLI commands against a site |

### Preview Sites (4)
| Tool | Description |
|------|-------------|
| `studio_preview_list` | List previews for a site |
| `studio_preview_create` | Create a shareable preview URL |
| `studio_preview_update` | Update an existing preview |
| `studio_preview_delete` | Delete a preview (requires `confirm: true`) |

### Auth (2)
| Tool | Description |
|------|-------------|
| `studio_auth_status` | Check WordPress.com login status |
| `studio_auth_logout` | Clear credentials |

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
