# Site Editor Performance Benchmark

Benchmarks site editor performance across Studio, Playground CLI, Playground Web, and custom WordPress environments, with optional plugin and multi-worker configurations.

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
| Custom                        | user-defined        | Any running WordPress site via `--custom`       |

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
--rounds=N                                    Number of benchmark runs per environment (default: 1)
--skip-studio                                 Skip Studio environments
--skip-playground-cli                         Skip Playground CLI environments
--skip-playground-web                         Skip Playground web environments
--custom=<name>,<url>[,<user>,<password>]     Add a custom WordPress site (repeatable)
                                                user defaults to "admin", password to "password"
--install-plugins                             Install blueprint plugins on ALL custom environments
--install-plugins=<name1>,<name2>             Install blueprint plugins on specific custom environments
--only=<env1,env2>                            Run only named environments (comma-separated)
--headed                                      Launch browser in headed mode for debugging
--help                                        Show help
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

# Benchmark a single custom WordPress site
npm run benchmark -- --custom=my-site,http://localhost:10003

# Two custom sites: bare vs with plugins
npm run benchmark -- \
  --custom=local-bare,http://localhost:10003 \
  --custom=local-plugins,http://localhost:10004 \
  --install-plugins=local-plugins

# Custom site with non-default credentials
npm run benchmark -- --custom=my-site,http://localhost:10003,admin,secret

# Compare Studio vs a custom site
npm run benchmark -- --only=studio,my-site --custom=my-site,http://localhost:10003 --rounds=3
```

## Custom Environments

Use `--custom` to add any running WordPress site to the benchmark. The flag is repeatable, so you can benchmark multiple custom sites in a single run. Each site must be accessible and have a WordPress admin account.

Format: `--custom=<name>,<url>[,<user>,<password>]`

- **name** — Label for the environment in the results table
- **url** — Base URL of the running WordPress site
- **user** — WordPress admin username (default: `admin`)
- **password** — WordPress admin password (default: `password`)

The benchmark logs in via `wp-login.php` using the provided credentials.

With `--install-plugins`, the benchmark installs the same set of plugins used by the built-in environments via the WordPress REST API before measuring. Use `--install-plugins` to install on all custom environments, or `--install-plugins=name1,name2` to target specific ones.

## Prerequisites

- **Dependencies**: Run `npm install` from the repo root to install all workspace dependencies
- **Studio CLI**: Built automatically if `dist/cli/main.mjs` doesn't exist (`npm run cli:build`)
- **Playwright**: Chromium is installed automatically during setup

## Output

Results are printed as a comparison table and saved to `metrics/artifacts/benchmark-comparison-<timestamp>.json`.
