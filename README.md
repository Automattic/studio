# WordPress Studio

[WordPress Studio](https://wordpress.studio/) is a free, open source development environment for WordPress. Create and manage local sites, build plugins and themes, and use AI to work on real WordPress projects. No Docker, external web server, or database setup required.

Start with a blank site, a Blueprint, or an existing WordPress site. Work through the desktop app, the command line, or an AI agent connected through MCP. Share previews for feedback, publish to [WordPress.com](https://wordpress.com/) or [Pressable](https://pressable.com/), or export your site to host elsewhere.

## Get started

Download WordPress Studio for your platform:

| Platform               | Downloads                                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS                  | [Apple Silicon](https://appscdn.wordpress.com/downloads/wordpress-com-studio/mac-silicon/latest) · [Intel](https://appscdn.wordpress.com/downloads/wordpress-com-studio/mac-intel/latest)                 |
| Windows                | [Intel/AMD — x64](https://appscdn.wordpress.com/downloads/wordpress-com-studio/windows-x64/latest) · [ARM64](https://appscdn.wordpress.com/downloads/wordpress-com-studio/windows-arm64/latest)           |
| Linux — Debian package | [Intel/AMD — x64](https://appscdn.wordpress.com/downloads/wordpress-com-studio/linux-x64/latest/update) · [ARM64](https://appscdn.wordpress.com/downloads/wordpress-com-studio/linux-arm64/latest/update) |

Create a site from scratch or a Blueprint, or import an existing WordPress backup. Open wp-admin, edit files in your preferred editor, or connect an AI provider and describe your first change.

[Read the getting started guide](https://developer.wordpress.com/docs/developer-tools/studio/)

## Develop locally

Run WordPress on your machine with a bundled native PHP runtime and a SQLite database. Manage multiple sites, test plugins and themes, and develop against local copies of production sites.

- Choose PHP and WordPress versions for each project.
- Configure custom domains and HTTPS.
- Use Blueprints for repeatable setups with your preferred themes, plugins, content, and settings.
- Access site files, inspect the database, and run WP-CLI commands.
- Import existing sites and export full-site or database backups.

[Explore local development features](https://developer.wordpress.com/docs/developer-tools/studio/sites/)

## Build and edit with AI

Use the built-in agent to create pages, develop plugins and themes, investigate issues, and run WP-CLI commands. It works with your site’s files and WordPress installation, with a live preview alongside the conversation.

Attach screenshots or reference files to your requests, or select an element in the preview and describe what you want to change. Continue working on the result in your editor or WordPress.

Connect through WordPress.com or use your own Anthropic API key. AI usage is subject to the connected provider’s credits and billing.

[Learn about AI features](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/)

## Share previews

Create a cloud-hosted preview of a local site to share with clients and teammates. Preview links remain accessible when your computer is offline, so you can gather feedback without running a tunnel or deploying to production.

Preview sites are free, require a WordPress.com account, and expire after seven days without updates.

[Learn about preview sites](https://developer.wordpress.com/docs/developer-tools/studio/preview-sites/)

## Publish and pull changes

Publish a local site to [WordPress.com](https://wordpress.com/) or [Pressable](https://pressable.com/), or pull an existing production or staging site into your local environment.

Choose what to transfer: the full site, database, individual plugins or themes, or other files in `wp-content`. Develop and test locally, then publish when you’re ready.

For other hosts, export your site and move it through your preferred deployment workflow.

[Learn about publishing and syncing](https://developer.wordpress.com/docs/developer-tools/studio/sync/)

## Use the CLI and your own agents

The WordPress Studio CLI brings site management to your terminal. Create and manage sites, run WP-CLI commands, import and export backups, create previews, and push or pull changes.

With the CLI installed:

```bash
# Create a local WordPress site
studio create

# List your sites
studio list

# Run WP-CLI against a local site
studio wp plugin list --path ~/Studio/my-site

# Start an interactive agent session
studio code
```

The built-in MCP (Model Context Protocol) server exposes WordPress tools to compatible AI clients, including Claude Code, Codex, and Cursor. Connect your agent to create sites, run WP-CLI commands, and work with your WordPress projects.

[CLI installation and usage](https://developer.wordpress.com/docs/developer-tools/studio/cli/) · [Connect your agent through MCP](https://developer.wordpress.com/docs/developer-tools/studio/mcp-on-studio/)

## Documentation

Visit the [WordPress Studio documentation](https://developer.wordpress.com/docs/developer-tools/studio/) for installation instructions, feature guides, troubleshooting, and FAQs.

For a walkthrough of chat, live previews, and annotations, read the [desktop experience beta announcement](https://wordpress.com/blog/2026/08/24/studio-agentic-beta/).

For questions or help using WordPress Studio, [contact our Happiness Engineers](https://developer.wordpress.com/contact/).

## Contribute

WordPress Studio welcomes bug reports, feature proposals, code contributions, and translations.

- [Report a bug](https://github.com/Automattic/studio/issues/new?assignees=&labels=Needs+triage%2C%5BType%5D+Bug&projects=&template=bug_report.yml).
- [Suggest a feature](https://github.com/Automattic/studio/issues/new?assignees=&labels=%5BType%5D+Feature+Request&projects=&template=feature_request.yml&title=Feature+Request%3A).
- Submit a pull request with a bug fix or enhancement.
- [Help translate WordPress Studio](https://translate.wordpress.com/projects/studio/).

To set up the development environment and run WordPress Studio from source, start with the [contributing guidelines](CONTRIBUTING.md) and [code contributions guide](docs/code-contributions.md).

For substantial new features, open an issue first so the approach can be discussed before implementation.

## License

WordPress Studio is licensed under [GPLv2](LICENSE.md).
