---
name: wpcom-remote-management
description: Manage a remote WordPress.com site with wpcom_request, including API namespace selection, endpoint discovery, content/template/theme/plugin operations, response-size limits, and visual verification.
user-invokable: true
---

# WordPress.com Remote Management

Use this skill after the mandatory remote-site plan check, before selecting endpoints or making changes to a WordPress.com site through `wpcom_request`.

## Tool Shape

`wpcom_request` supports both the WordPress REST API and WordPress.com REST API endpoints:

- `method`: `GET`, `POST`, `PUT`, or `DELETE`
- `path`: relative to `/sites/{siteId}/`, such as `/posts`, `/posts/123`, or `/templates`
- `query`: optional query parameters object
- `body`: optional request body for `POST` and `PUT`
- `bodyFile`: optional staged JSON file path for `POST` and `PUT`; the parsed JSON object becomes the entire request body
- `bodyFiles`: optional map of top-level request body field names to staged file paths for `POST` and `PUT`; each file becomes that field's string value
- `apiNamespace`: defaults to `"wp/v2"`; set to `""` for WordPress.com REST API v1.1, or `"wpcom/v2"` for WordPress.com v2 endpoints

Prefix `path` with `!` only for absolute paths such as `!/me`.

## Namespace Selection

Prefer `wp/v2` for standard WordPress resources:

- Posts, pages, media, categories, tags, users, comments
- Templates, template parts, navigation, global styles, block patterns
- Block types and search

Use WordPress.com v1.1 by setting `apiNamespace: ""` for WordPress.com-specific resources:

- Site info: `GET /`
- Site settings: `POST /settings`
- Plugin management: `GET /plugins`, `POST /plugins/{slug}/install`, `POST /plugins/{slug}` with body `{ active: true }` or `{ active: false }`
- Theme switching: `GET /themes`, `POST /themes/mine` with body `{ theme: "slug" }`
- Media upload from URL: `POST /media/new` with body `{ media_urls: [...] }`

## Common wp/v2 Endpoints

- Posts and pages: `GET /posts`, `GET /posts/{id}`, `POST /posts`, `POST /posts/{id}`, `DELETE /posts/{id}`
- Media: `GET /media`, `POST /media`
- Templates: `GET /templates`, `GET /templates/{id}`, `POST /templates`, `POST /templates/{id}`, `DELETE /templates/{id}`
- Template parts: `GET /template-parts`, `GET /template-parts/{id}`, `POST /template-parts`, `POST /template-parts/{id}`
- Navigation: `GET /navigation`, `POST /navigation`, `POST /navigation/{id}`
- Global styles: `GET /global-styles/{id}`, `POST /global-styles/{id}`
- Categories and tags: `GET /categories`, `POST /categories`, `GET /tags`, `POST /tags`
- Block types: `GET /block-types`, `GET /block-types/{name}`
- Search: `GET /search?search={query}`

To find the global styles ID, first call `GET /themes?status=active`; the active theme's `_links["wp:user-global-styles"][0].href` contains the ID.

Use `per_page` and `page` for pagination. Use `status` to filter by publish status. For creating or updating content, pass block markup in the `content` field of the request body.

## Response Size Control

Minimize response sizes to avoid exceeding tool output limits:

- Use `_fields` for `wp/v2`.
- Use `fields` for WordPress.com v1.1.
- Exclude heavy fields such as `content` when listing resources.
- Fetch lightweight listings first, then fetch individual resources by ID when full content is needed.
- When using `fields` with v1.1, always include `ID`.

Examples:

```text
GET /posts?_fields=id,slug,title,status
GET /plugins?fields=ID,name,description,URL
```

## Large Request Bodies

For generated page content, template content, template-part content, global styles, or CSS, do not inline large generated strings in `wpcom_request.body`.

Stage request payload files under `tmp/ai-payloads/` within Studio app data using small `Write` or `Edit` steps.

Use `bodyFiles` when staged files should become string fields inside the request body:

```text
body: { "status": "publish" }
bodyFiles: { "content": "tmp/ai-payloads/home.html" }
```

The `bodyFiles` keys must be top-level REST body field names such as `content`, `excerpt`, or `css`, not filenames or nested paths. Do not use keys like `home.html`, `styles.css`, `content.raw`, or `styles.color.background`.

Staged payload files are single-use. When updating an existing resource, restage the file with the new content, based on its freshly fetched current content (`context=edit`) — never reuse a `tmp/ai-payloads/` file written for an earlier request or session. The live content may have changed since it was staged (for example, edits made in the WordPress editor), and resending a stale file overwrites those changes.

Use `bodyFile` when the staged file is the complete JSON request body, especially for endpoints that expect nested JSON objects such as `POST /global-styles/{id}`:

```text
bodyFile: "tmp/ai-payloads/global-styles.json"
```

Do not combine `bodyFile` with `body` or `bodyFiles`.

## Workflow

1. Check the site plan first. This is already required by the remote system prompt and must happen before any change.
2. Understand the site with lightweight reads, such as `GET /posts` and `GET /themes?status=active`.
3. Before updating existing content (a post, page, template, or template part), fetch its current raw content first — for example `GET /posts/{id}?context=edit&_fields=id,content` — and base the update on that response. Never resend previously staged or remembered content; the user may have edited it in the WordPress editor since.
4. Make changes with POST requests to create or update content, manage templates, switch themes, or manage plugins.
5. Verify visually with `take_screenshot` using `viewport: "all"` for desktop and mobile.
6. If an operation fails, inspect the error and try a lightweight GET request to discover the available shape before retrying.

Always confirm destructive operations, including deleting posts or deactivating plugins, before proceeding.
