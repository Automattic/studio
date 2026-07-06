---
name: self-hosted-remote-management
description: Manage a self-hosted WordPress site with wp_request, including endpoint discovery, content/template/theme/plugin operations, response-size limits, staged request bodies, and visual verification.
user-invokable: true
---

# Self-Hosted Remote Management

Use this skill before selecting endpoints or making changes to a self-hosted WordPress site through `wp_request`.

## Tool Shape

`wp_request` calls the site's own WordPress REST API, authenticated with the saved Application Password (Basic Auth):

- `method`: `GET`, `POST`, `PUT`, or `DELETE`
- `path`: relative to the namespace, such as `/posts`, `/posts/123`, or `/templates`
- `query`: optional query parameters object
- `body`: optional request body for `POST` and `PUT`
- `bodyFile`: optional staged JSON file path for `POST` and `PUT`; the parsed JSON object becomes the entire request body
- `bodyFiles`: optional map of top-level request body field names to staged file paths for `POST` and `PUT`; each file becomes that field's string value
- `apiNamespace`: defaults to `"wp/v2"`; set to a plugin namespace such as `"wc/v3"` (WooCommerce) for plugin-registered endpoints

Unlike WordPress.com sites, there is no WordPress.com v1.1 API and no plan-based feature gating. Capabilities depend on the connected user's role: a `401` or `403` response means the Application Password's user lacks the required capability, not that the feature needs an upgrade.

## Common wp/v2 Endpoints

- Posts and pages: `GET /posts`, `GET /posts/{id}`, `POST /posts`, `POST /posts/{id}`, `DELETE /posts/{id}` (same shape for `/pages`)
- Media: `GET /media`, `POST /media`
- Templates: `GET /templates`, `GET /templates/{id}`, `POST /templates`, `POST /templates/{id}`, `DELETE /templates/{id}` (block themes only)
- Template parts: `GET /template-parts`, `GET /template-parts/{id}`, `POST /template-parts`, `POST /template-parts/{id}`
- Navigation: `GET /navigation`, `POST /navigation`, `POST /navigation/{id}`
- Global styles: `GET /global-styles/{id}`, `POST /global-styles/{id}`
- Categories and tags: `GET /categories`, `POST /categories`, `GET /tags`, `POST /tags`
- Site settings: `GET /settings`, `POST /settings`
- Themes: `GET /themes`, `GET /themes?status=active`
- Plugins: `GET /plugins`, `POST /plugins` with body `{ slug: "plugin-slug", status: "active" }` to install from WordPress.org, `POST /plugins/{plugin}` with body `{ status: "active" }` or `{ status: "inactive" }` to toggle
- Users: `GET /users`, `GET /users/me`
- Block types: `GET /block-types`, `GET /block-types/{name}`
- Search: `GET /search?search={query}`

To find the global styles ID, first call `GET /themes?status=active`; the active theme's `_links["wp:user-global-styles"][0].href` contains the ID.

Use `per_page` and `page` for pagination. Use `status` to filter by publish status. For creating or updating content, pass block markup in the `content` field of the request body.

`DELETE` on posts, pages, and templates moves the resource to trash by default; pass `query: { force: true }` to delete permanently (required for resource types without trash).

## Response Size Control

Minimize response sizes to avoid exceeding tool output limits:

- Use `_fields` to request only the properties you need.
- Exclude heavy fields such as `content` when listing resources.
- Fetch lightweight listings first, then fetch individual resources by ID when full content is needed.

Example:

```text
GET /posts?_fields=id,slug,title,status
```

## Large Request Bodies

For generated page content, template content, template-part content, global styles, or CSS, do not inline large generated strings in `wp_request.body`.

Stage request payload files under `tmp/ai-payloads/` within Studio app data using small `Write` or `Edit` steps.

Use `bodyFiles` when staged files should become string fields inside the request body:

```text
body: { "status": "publish" }
bodyFiles: { "content": "tmp/ai-payloads/home.html" }
```

The `bodyFiles` keys must be top-level REST body field names such as `content`, `excerpt`, or `css`, not filenames or nested paths. Do not use keys like `home.html`, `styles.css`, `content.raw`, or `styles.color.background`.

Use `bodyFile` when the staged file is the complete JSON request body, especially for endpoints that expect nested JSON objects such as `POST /global-styles/{id}`:

```text
bodyFile: "tmp/ai-payloads/global-styles.json"
```

Do not combine `bodyFile` with `body` or `bodyFiles`.

## Workflow

1. Understand the site with lightweight reads, such as `GET /settings`, `GET /posts?_fields=id,slug,title,status`, and `GET /themes?status=active`.
2. Make changes with POST requests to create or update content, manage templates, switch themes, or manage plugins.
3. Verify visually with `take_screenshot` using `viewport: "all"` for desktop and mobile.
4. If an operation fails, inspect the error and try a lightweight GET request to discover the available shape before retrying. On `401`/`403`, explain the missing capability instead of retrying.

Always confirm destructive operations, including deleting posts or deactivating plugins, before proceeding.
