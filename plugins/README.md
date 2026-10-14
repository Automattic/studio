# WordPress Studio plugins

Plugins that bring [WordPress Studio](https://developer.wordpress.com/studio/) to agent apps.

- [wp-studio](wp-studio): build, design, and manage WordPress sites from Codex in the ChatGPT app.

## Install in Codex

```bash
codex plugin marketplace add Automattic/studio-plugins
codex plugin add wp-studio@studio
```

Restart the ChatGPT app afterwards. The app ships its own Codex at
`/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`. To update, run
`codex plugin marketplace upgrade studio`, then `codex plugin add wp-studio@studio` again.

## Development

The plugins are developed in [Automattic/studio](https://github.com/Automattic/studio/tree/trunk/plugins)
and published to [Automattic/studio-plugins](https://github.com/Automattic/studio-plugins) with each
Studio release, versioned as that release and with the Studio CLI inside (`cli.tar.br`). Each release
replaces that repository's single commit, so cloning it never fetches older copies of the CLI. Open
issues and pull requests in Automattic/studio.

To try your changes, add the marketplace from your checkout, `codex plugin marketplace add ./plugins`,
and point the plugin at a Studio CLI build with `STUDIO_CLI_BIN`. `npm run cli:bundle:plugin` builds
the plugin with the CLI inside.
