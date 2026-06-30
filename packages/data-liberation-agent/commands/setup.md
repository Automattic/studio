---
name: setup
description: Validate a WordPress connection — check site reachability, REST API, and authentication before importing
---

Run the setup command to validate a WordPress connection before importing content. Tests three things in order and provides step-by-step guidance when something fails.

## What it checks

1. **Site reachable** — can we connect to the site at all?
2. **REST API available** — does `/wp-json` respond with a valid WordPress API index?
3. **Authentication** — do the username and application password work against `/wp-json/wp/v2/users/me`?

## Guidance

If any step fails, the report includes specific guidance:

- **Unreachable site** — check URL format, site accessibility, WordPress.com vs self-hosted
- **REST API unavailable** — check for security plugins blocking the API, verify it's actually a WordPress site
- **Auth failure** — how to create an Application Password (WordPress Admin > Users > Profile). On WordPress.com / wpcomstaging.com hosts, the password MUST come from the site's own wp-admin — wordpress.com/me/security/application-passwords issues account-level passwords that only work for the public-api.wordpress.com namespace. Common mistakes: using account password instead of app password, using email instead of username, using account-level WP.com app password against site-native /wp-json/wp/v2/.

## Usage

Via MCP: `liberate_setup` with `site`, `username`, and `token` parameters.

Via CLI: `data-liberation setup` (prompts interactively for missing credentials)

CLI also accepts flags: `--site <domain> --username <user> --token <password>`

## When to use

- Before the first import to a new WordPress site
- When import fails with authentication errors
- When the user says they don't have a WordPress site yet (guide them through creating one)
