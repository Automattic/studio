# Set up WordPress Studio for your coding agent

These steps are written for an AI coding agent (Codex, Claude Code, …) to follow on the user's machine. The user pastes something like:

> Set up WordPress Studio by following https://github.com/Automattic/studio/blob/trunk/plugins/studio-code/SETUP.md

Run each step, tell the user what you did, and stop to ask when a step needs them.

## 1. Install the Studio CLI

Run `studio --version`. If the command is missing, install it (no admin rights needed; it downloads about 260 MB into `~/.studio` and adds `~/.local/bin` to the PATH):

```bash
curl -fsSL https://wordpress.studio/install.sh | bash
```

If the WordPress Studio desktop app is installed, its CLI works too; keep it. The plugin also installs the CLI by itself the first time it starts without one, but running the installer here first avoids a long first start.

## 2. Log in to WordPress.com (recommended)

Run `studio auth status`. If the user is not logged in, explain that a free WordPress.com account lets Studio generate images for their sites, share preview links, and publish to WordPress.com, and ask whether to log in now. If they agree, run `studio auth login`: it opens their browser to approve the login. Local site building works without it.

## 3. Install the plugin

**Codex:**

```bash
codex plugin marketplace add Automattic/studio
codex plugin add studio-code
```

**Claude Code:** run `/plugin marketplace add Automattic/studio`, then `/plugin install studio-code@studio`.

**Any other MCP client:** add a stdio server named `wordpress-studio` that runs `studio mcp` (`studio mcp` in a terminal prints the configuration).

## 4. Finish

Ask the user to start a new session so the Studio tools load, then to try a first request, for example: "Build a WordPress site for my bakery".
