# Site Editor Performance Benchmark

Benchmarks site editor performance across Studio, Playground CLI, Playground Web, and Local by Flywheel environments, with optional plugin and multi-worker configurations.

## Related Issue

[STU-1290](https://linear.app/a8c/issue/STU-1290)

## What It Measures

The benchmark launches a headless Chromium browser against each environment, measuring:

| Metric                | Description                                                |
| --------------------- | ---------------------------------------------------------- |
| **siteEditorLoad**    | Time from clicking Appearance > Editor to blocks rendering |
| **templatesViewLoad** | Time to open the Templates view and load template cards    |
| **templateOpen**      | Time to open a specific template in the editor             |
| **blockAdd**          | Time to add a paragraph and heading block                  |
| **templateSave**      | Time to save the template                                  |

## Environment Matrix

| Environment                   | Name                | Description                                     |
| ----------------------------- | ------------------- | ----------------------------------------------- |
| Studio                        | `studio`            | Bare Studio site                                |
| Studio + MW                   | `studio-mw`         | Studio with multi-worker support enabled        |
| Studio + Plugins              | `studio-plugins`    | Studio with 10 plugins installed                |
| Studio + MW + Plugins         | `studio-mw-plugins` | Studio with multi-worker and 10 plugins         |
| Playground CLI                | `pg-cli`            | Bare Playground CLI site                        |
| Playground CLI + MW           | `pg-cli-mw`         | Playground CLI with multi-worker                |
| Playground CLI + Plugins      | `pg-cli-plugins`    | Playground CLI with 10 plugins                  |
| Playground CLI + MW + Plugins | `pg-cli-mw-plugins` | Playground CLI with multi-worker and 10 plugins |
| Playground Web                | `pg-web`            | playground.wordpress.net (bare)                 |
| Playground Web + Plugins      | `pg-web-plugins`    | playground.wordpress.net with 10 plugins        |
| Local                         | `local`             | Local by Flywheel site (nginx+PHP+MySQL)        |
| Local + Plugins               | `local-plugins`     | Local with 10 plugins installed                 |

## Plugins

When the "plugins" variant is enabled, these 10 plugins are installed via a blueprint:

- WooCommerce
- Jetpack
- WP Super Cache
- Jetpack Boost
- Jetpack Protect
- Jetpack Social
- Jetpack VideoPress
- WooCommerce Payments
- Contact Form 7
- CoBlocks

## Usage

```bash
cd tools/benchmark-site-editor
npm install
npm run benchmark
```

### Options

```
--rounds=N              Number of benchmark runs per environment (default: 1)
--skip-studio           Skip Studio environments
--skip-playground-cli   Skip Playground CLI environments
--skip-playground-web   Skip Playground web environments
--include-local         Include Local by Flywheel environments (requires Local running)
--only=<env1,env2>      Run only named environments (comma-separated)
--help                  Show help
```

### Examples

```bash
# Quick test: only Studio bare vs Studio with plugins
npm run benchmark -- --only=studio,studio-plugins

# Full comparison without Playground Web (faster, no network dependency)
npm run benchmark -- --skip-playground-web --rounds=3

# Only Playground CLI environments
npm run benchmark -- --skip-studio --skip-playground-web

# Single specific environment
npm run benchmark -- --only=studio-mw-plugins --rounds=5

# Include Local by Flywheel (must be running)
npm run benchmark -- --include-local --only=local,local-plugins

# Compare Studio vs Local
npm run benchmark -- --only=studio,local --rounds=3
```

> **Note:** When using `--only` with Local environments, the `--include-local` flag is not needed — Local environments are automatically included when explicitly named.

## Prerequisites

- **Studio CLI**: Built automatically if `dist/cli/main.js` doesn't exist (`npm run cli:build`)
- **Playground CLI**: Installed automatically via this script's `npm install`
- **Playwright**: Chromium is installed automatically during setup
- **Local by Flywheel**: Must be installed and running (GUI app). Use `--include-local` to enable. The script connects to Local's GraphQL API to create and manage benchmark sites.
  - macOS: `brew install --cask local`
  - Windows: `winget install Flywheel.Local`

## Output

Results are printed as a comparison table and saved to `metrics/artifacts/benchmark-comparison-<timestamp>.json`.
