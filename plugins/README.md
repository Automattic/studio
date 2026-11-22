# WordPress Studio plugins

Plugins that bring [WordPress Studio](https://wordpress.studio/) to agent apps.

- [wp-studio](wp-studio): build, design, and manage WordPress sites from Codex in the ChatGPT app,
  from Claude Code, from Cursor, and from Grok Build.

With the Studio app, open **Settings** → **MCP** and select **Connect** next to your agent app. It
installs the plugin for you.

## Install in Codex

```bash
codex plugin marketplace add Automattic/studio-plugins
codex plugin add wp-studio@studio
```

Restart the ChatGPT app afterwards. The app ships its own Codex at
`/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`. To update, run
`codex plugin marketplace upgrade studio`, then `codex plugin add wp-studio@studio` again.

## Install in Claude Code

```bash
claude plugin marketplace add Automattic/studio-plugins
claude plugin install wp-studio@studio
```

Claude Code runs the plugin with the Node.js on your `PATH`, version 22 or later. Start a new session
afterwards, or run `/reload-plugins`. To update, run `claude plugin update wp-studio@studio`.

## Install in Cursor

```bash
git clone --depth 1 https://github.com/Automattic/studio-plugins
mkdir -p ~/.cursor/plugins/local
cp -R studio-plugins/wp-studio ~/.cursor/plugins/local/WordPress-Studio
```

Then restart Cursor, or run **Developer: Reload Window**. Cursor names a local plugin after its
folder, so the folder name is what shows as WordPress Studio. Cursor runs the plugin with the
Node.js on your `PATH`, version 22 or later. To update, replace that folder with the one of a newer
clone. On a Teams or Enterprise plan, an admin can instead import Automattic/studio-plugins as a
team marketplace. Grok Bot doesn't list the plugin: it runs in the cloud, and Studio works with
sites on your computer.

## Install in Grok Build

```bash
grok plugin install Automattic/studio-plugins@claude-directory --trust
```

Grok Build gives up on cloning a marketplace after 15 seconds, sooner than this repository, which
carries the Studio CLI, takes. So it installs the plugin of the `claude-directory` branch, which
downloads the CLI the first time it starts. Grok Build runs the plugin with the Node.js on your
`PATH`, version 22 or later. Start a new session afterwards. To update, run
`grok plugin update wp-studio`.

## Development

The plugins are developed in [Automattic/studio](https://github.com/Automattic/studio/tree/trunk/plugins)
and published to [Automattic/studio-plugins](https://github.com/Automattic/studio-plugins) with each
Studio release, versioned as that release and with the Studio CLI inside (`cli.tar.br`). Each release
replaces that repository's single commit, so cloning it never fetches older copies of the CLI. The
`claude-directory` branch holds the plugin for Anthropic's directory and Grok Build, which downloads
the CLI from the Studio release instead of carrying it. Open issues and pull requests in
Automattic/studio.

To try your changes, add the marketplace from your checkout (`codex plugin marketplace add ./plugins`,
`claude --plugin-dir ./plugins/wp-studio` for one Claude Code session, a copy of `plugins/wp-studio`
in `~/.cursor/plugins/local/WordPress-Studio`, as Cursor skips symlinks to folders outside it, or
`grok plugin install ./plugins/wp-studio --trust`) and point the plugin at a Studio CLI build with
`STUDIO_CLI_BIN`. `npm run cli:bundle:plugin` builds the plugin with the CLI inside, the plugin for
Anthropic's directory, and the CLI download to attach to the release.
