# MCP on Studio

Agent instruction files tell agents how to work with a Studio site, but they do not give agents direct access to it. For that, Studio also exposes an MCP (Model Context Protocol) server that agents connect to in order to create, start, stop, and interact with your local WordPress sites.

To connect an agent, open **App settings** in Studio (at the bottom of the sidebar, or ⌘, / Ctrl+,), select the **MCP** tab, and click **Copy MCP configuration** to copy the JSON configuration shown there. Add it to your agent’s MCP settings:

```json
{
  "wordpress-studio": {
    "command": "studio",
    "args": ["mcp"]
  }
}
```

For Claude Code or Codex you can also run the connection command directly from the terminal:

```
claude mcp add wordpress-studio -- studio mcp
codex mcp add wordpress-studio -- studio mcp
```

[![The MCP tab of Studio's App settings, with the MCP configuration and the Copy MCP configuration button.](https://developer.wordpress.com/wp-content/uploads/2026/04/app-settings-mcp.png)](https://developer.wordpress.com/wp-content/uploads/2026/04/app-settings-mcp.png)

Common configuration file locations are:

-   Claude Desktop
    -   macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
    -   Windows: `%APPDATA%\Claude\claude_desktop_config.json`
-   Cursor:
    -   Project: `.cursor/mcp.json`
    -   Global `~/.cursor/mcp.json`

See the full setup guides for [Claude Code](https://code.claude.com/docs/en/mcp), [Claude Desktop,](https://modelcontextprotocol.io/docs/develop/connect-local-servers) [Codex](https://developers.openai.com/codex/mcp), [Cursor](https://cursor.com/docs/mcp#installing-mcp-servers), [Windsurf](https://docs.windsurf.com/windsurf/cascade/mcp), [VS Code](https://code.visualstudio.com/docs/copilot/customization/mcp-servers).

Once connected, the agent can use Studio tools such as creating sites, running WP-CLI commands, and taking screenshots, in addition to reading the instruction files and skills already present in the site directory.

## What the agent gets

-   **Studio’s instructions and skills, on demand.** The agent calls a `studio_instructions` tool before its first WordPress task, so it follows the same workflow and rules as Studio Code, without Studio filling the agent’s context for every conversation.
-   **Local and WordPress.com sites.** The agent can work on your local Studio sites and on your WordPress.com sites, and can copy content between them.
-   **A picker for your site’s look and layout.** When you start a site, the agent can show rendered design options to choose from. In agents that render MCP Apps, such as Codex, you click an option. In other agents, the agent shows the previews in the chat and you reply with your choice. See [Designing a site](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/#designing-a-site).
-   **A WordPress tab.** In agent apps that render MCP Apps and support sidebar entries, a **WordPress** tab lists your local Studio sites and your WordPress.com sites.
-   **Site images.** Agents that have their own image tool, such as Codex, use it to make site images. See [Image generation in Studio Code](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/image-generation/).
-   **Fewer approval prompts.** Studio tells the agent which tools only read, or only change, this machine, so agents like Codex don’t ask for approval before each of those calls.