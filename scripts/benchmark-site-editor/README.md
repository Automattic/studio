# Site Editor Performance Benchmark

Benchmarks site editor performance across Studio, Playground CLI, and Playground Web environments, with optional plugin and multi-worker configurations.

## Related Issue

[STU-1290](https://linear.app/a8c/issue/STU-1290)

## What It Measures

The benchmark runs the `site-editor-benchmark` Playwright test against each environment, measuring:

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
- Elementor

## Usage

```bash
cd scripts/benchmark-site-editor
npm install
npm run benchmark
```

### Options

```
--rounds=N              Number of benchmark runs per environment (default: 1)
--skip-studio           Skip Studio environments
--skip-playground-cli   Skip Playground CLI environments
--skip-playground-web   Skip Playground web environments
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
```

## Prerequisites

- **Studio CLI**: Built automatically if `dist/cli/main.js` doesn't exist (`npm run cli:build`)
- **Playground CLI**: Installed automatically via this script's `npm install`
- **Playwright**: Must be installed at the repo root (`npx playwright install chromium`)

## Output

Results are printed as a comparison table and saved to `metrics/artifacts/benchmark-comparison-<timestamp>.json`.

Individual results per environment are saved to `metrics/artifacts/<env-name>.results.json`.
