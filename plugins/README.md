# WordPress Studio plugins

Plugins that bring [WordPress Studio](https://wordpress.studio/) to agent apps.

- [wp-studio](wp-studio): build, design, and manage WordPress sites from Codex in the ChatGPT app,
  and from Claude Code.

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

## Development

The plugins are developed in [Automattic/studio](https://github.com/Automattic/studio/tree/trunk/plugins)
and published to [Automattic/studio-plugins](https://github.com/Automattic/studio-plugins) with each
Studio release, versioned as that release and with the Studio CLI inside (`cli.tar.br`). Each release
replaces that repository's single commit, so cloning it never fetches older copies of the CLI. The
`claude-directory` branch holds the plugin for Anthropic's directory, which is too small to carry the
CLI and downloads it from the Studio release instead. Open issues and pull requests in
Automattic/studio.

To try your changes, add the marketplace from your checkout (`codex plugin marketplace add ./plugins`,
or `claude --plugin-dir ./plugins/wp-studio` for one Claude Code session) and point the plugin at a
Studio CLI build with `STUDIO_CLI_BIN`. `npm run cli:bundle:plugin` builds the plugin with the CLI
inside, the plugin for Anthropic's directory, and the CLI download to attach to the release.
