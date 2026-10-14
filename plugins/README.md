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
Studio release, versioned as that release. Open issues and pull requests in Automattic/studio. To try
your changes, add the marketplace from your checkout: `codex plugin marketplace add ./plugins`.
