---
name: headless-frontend
description: Build and iterate on a headless (decoupled) Studio site, whose pages are rendered by a separate frontend project (static HTML, Astro, or Next.js) reading WordPress over REST or GraphQL. Covers where the code goes, fetching and modeling content, previews and revalidation, the frontend dev server, and verification.
---

# Headless Frontend

Use this skill for work on a headless site: one the Active site section or `site_info` marks as headless. WordPress is the backend only (content, data model, API, editor). What visitors see is the frontend project, so design, layout, and page work happen in its code.

## 1. Orient

- Get the facts from the Active site section or `site_info`: the frontend folder, its URL, the framework, the API (`rest` or `graphql`), the WordPress URL, the REST base (`<wordpress>/wp-json/wp/v2`), and the GraphQL endpoint when the API is `graphql`.
- Read the frontend's `AGENTS.md` (and `README.md`) first: they describe the project layout, the data layer, and the routes. Follow its conventions rather than restructuring the project.
- The frontend reads its settings from `.env.local`: `WORDPRESS_URL`, `WORDPRESS_HOSTNAME`, `WORDPRESS_GRAPHQL_URL` (GraphQL only), `WORDPRESS_APPLICATION_USER` and `WORDPRESS_APPLICATION_PASSWORD` (the least-privilege `studio-frontend` editor), `STUDIO_PREVIEW_SECRET`, `STUDIO_REVALIDATE_SECRET`, and `PORT`. Use them by name in code. Never print, echo, or repeat their values, never hardcode them, and never expose the secrets or the application password to the browser (no `NEXT_PUBLIC_` or `PUBLIC_` copies, no client-side fetches that send them).

## 2. Where changes go

- Pages, layout, styles, components, and data fetching: the frontend project, with Write and Edit.
- Content, its structure, and settings: WordPress, the WordPress way, through `wp_cli`.
- Do not scaffold or edit a block theme, `theme.json`, or templates for the frontend's look, and do not run `validate_blocks` on frontend files. Post and page content written into WordPress is still block markup: validate that with `validate_blocks` as usual.
- Studio runs the frontend's dev server. Never start it, or any long-running process, through Bash (`npm run dev`, `astro dev`, `next dev`). After changing dependencies (`npm install <package>` through Bash is fine), config files, or `.env.local`, call `frontend_restart`. Ordinary source edits hot-reload.

## 3. Fetch content

Over REST (always available; public content needs no authentication):

- Posts: `GET <restBase>/posts?_embed&per_page=10` — `_embed` brings the author, the featured image (`_embedded['wp:featuredmedia'][0]`), and the terms in one request. Pages: `<restBase>/pages?slug=<slug>`.
- Images: a media item's `media_details.sizes` holds each size's `source_url`, `width`, and `height`; use them for responsive images. In Next.js the WordPress host is allowed in `images.remotePatterns` through `WORDPRESS_HOSTNAME`.
- Custom post types and taxonomies: read their `rest_base` from `<wordpress>/wp-json/wp/v2/types` and `/taxonomies`, then fetch `<restBase>/<rest_base>`.
- Render `content.rendered` and `excerpt.rendered` as HTML; never show `.raw`. Pagination comes from the `X-WP-Total` and `X-WP-TotalPages` headers.
- Drafts and private content need the application password as Basic auth, server-side only.

Over GraphQL (when the API is `graphql`): POST queries to `WORDPRESS_GRAPHQL_URL`, e.g. `posts(first: 10) { nodes { title slug excerpt date featuredImage { node { sourceUrl altText mediaDetails { width height } } } } }`. A custom post type or field appears in the schema only when registered with `show_in_graphql`.

Before writing a fetch, check the endpoint returns what you expect, e.g. `curl -s "<restBase>/posts?per_page=1&_embed"` through Bash, and read the data layer the template ships so new code reuses its client.

## 4. Model and seed content

- Register custom post types, taxonomies, and meta in a small must-use plugin, `wp-content/mu-plugins/<site-slug>-content-model.php`, so the model is code that travels with the site. Give each `show_in_rest => true` (and `show_in_graphql => true` with a `graphql_single_name` and `graphql_plural_name` for GraphQL), and register meta with `register_post_meta( ..., [ 'show_in_rest' => true, 'single' => true, 'type' => ... ] )`. `wp scaffold post-type` and `wp scaffold taxonomy` print a starting point.
- Seed content with `wp_cli`: `post create --post_type=<type> --post_status=publish --post_title=... --post_content=...`, `term create`, `post meta update`, and `media import <file> --post_id=<id> --featured_image`. Keep seeded content realistic and few: enough to show every layout.
- After registering post types, flush rewrite rules (`rewrite flush`).

## 5. Previews and revalidation

The template ships both routes; keep them working when you change the data layer.

- Previews: WordPress sends the editor's Preview button to `<frontend>/api/draft?secret=<STUDIO_PREVIEW_SECRET>&id=<id>&type=<post type>&status=<status>`. The route checks the secret, turns on the framework's draft mode (Next.js `draftMode()`; Astro in server mode), and redirects to the post's page, which then fetches the draft with the application password. A wrong secret returns 401.
- Revalidation: WordPress POSTs `{ paths, tags }` to `<frontend>/api/revalidate` with the `X-Studio-Revalidate-Secret` header when content changes. The route checks the header against `STUDIO_REVALIDATE_SECRET` and revalidates those paths and tags (Next.js `revalidatePath` and `revalidateTag`). Never read the secret from the query string.
- A page that does not update after an edit: check the frontend's caching first, then `frontend_logs` for the revalidate request.

## 6. Verify

- Check the result on the frontend URL, not WordPress's: `take_screenshot` and `inspect_design` with `nameOrPath` (they resolve to the frontend on a headless site), `display: false` while iterating.
- When the frontend fails to load, errors, or renders empty or stale content, read `frontend_logs` before changing code; restart with `frontend_restart` only when it stopped or its config changed.
- Then tell the user what changed and the frontend URL to see it. Content is edited in wp-admin as usual.
