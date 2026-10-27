# Publishing docs updates through the WordPress.com MCP

Research notes on using the WordPress.com MCP connection to push the Markdown changes in `docs/` to developer.wordpress.com, one page at a time, with a manual check between pages. 

## Connection and access

- The WordPress.com MCP connector already reaches the site: developer.wordpress.com is site `33534099`, a simple site. MCP access is reported as "limited", which only affects advanced tool families such as plugin management, not content.
- `content-items.get` with `context=edit` returned raw block markup and SEO meta, so the account has edit permission on the docs.
- The docs are the custom post type `documentation`: hierarchical, supports `title`, `editor`, `page-attributes`, `revisions`, `custom-fields`, `autosave`.

### Post IDs

| Page | Post ID |
| --- | --- |
| `index.md` | 102760 |
| `sites.md` | 124088 |
| `cli.md` | 125830 |
| `studio-code/index.md` | 132059 |
| `studio-code/ai-credits-guidelines.md` | 133286 |
| `studio-code/choosing-an-ai-model-tier-in-studio-code.md` | 133511 |
| `studio-code/image-generation.md` | 133371 |
| `agent-skills-wordpress-studio.md` | 132187 |
| `mcp-on-studio.md` | 132112 |
| `blueprints/index.md` | 128718 |
| `blueprints/open-in-wordpress-studio-button.md` | 129351 |
| `guides/how-to-create-custom-blueprints.md` | 128731 |
| `preview-sites.md` | 124091 |
| `sync.md` | 124071 |
| `import-export.md` | 124095 |
| `ssl-in-studio.md` | 124785 |
| `php-runtimes.md` | 132858 |
| `debugging/index.md` | 131049 |
| `xdebug.md` | 129592 |
| `frequently-asked-questions.md` | 124099 |
| `changelog.md` | 127728 |
| `feedback/index.md` | 127730 |

## What the MCP tools can and can't do

| Need | Status |
| --- | --- |
| Read raw markup | Yes: `content-items.get` with `post_type: documentation`, `context: edit` |
| Write | Yes, but only `content-items.update`, which replaces the whole `content`. Each write needs `user_confirmed: true`, so the tool asks before every write. |
| Block-level edits | No. `post-sections.list` on a documentation ID fails with `Ability "wpcom-mcp/posts-get" does not have necessary permission`. The section operations' optimistic locking (`expected_modified`, `expected_content_hash`) is therefore unavailable too. |
| Revisions / rollback | Not exposed through MCP. Roll back in wp-admin → Revisions (the post type supports them). |
| Staged change to a published doc | No. Updating a published item goes live immediately; WordPress has no "pending update" state for published posts. |

## Custom blocks, and what the Markdown loses

The Markdown mirror comes from the site's "Copy page" Turndown transform. It is a one-way, lossy export, so page content must never be regenerated from Markdown.

| Block | Pages | In the Markdown |
| --- | --- | --- |
| `wpcom-devleoper/callout-block` (the misspelling is the real block name). Attributes: `calloutType` (`warning`, `info`), `showHeading`; optional heading; inner paragraph blocks. | sites, cli, agent-skills, custom-blueprints guide, sync, import-export | A plain paragraph, indistinguishable from the text around it |
| `a8c-docs/syntax-highlighting` (`toggleLineNumbers`, `lang-*` class on `<code>`). Saved HTML includes a `<textarea>` copy of the code and a copy `<button>`. | custom-blueprints guide, FAQ, studio-code | A fenced code block |
| `syntaxhighlighter/code` | 9 pages | A fenced code block, indistinguishable from the one above |
| `core/buttons` | custom-blueprints guide, open-in-studio button, changelog | A plain link |
| `core/table` | 4 pages | Cell text only (`textContent`), so inline `<code>` and links in cells are lost |
| Heading `anchor`, image `id` / `sizeSlug` / `linkDestination`, ordered list `start` | most pages | Lost, or turned into ToC links like `## [Heading](#1-heading)` |

Two risks to test before relying on round trips:

- The two syntax-highlighting blocks are not in `blocks.allowed` (site editor context), although they render on the live site. That list can't be used to validate markup.
- If the account lacks `unfiltered_html`, kses may strip the `<textarea>` and `<button>` from `a8c-docs/syntax-highlighting` on save. The MCP itself warns that WordPress silently strips unsupported markup and reports it in `_content_warnings`.

## Proposed process

The Markdown diff is the *intent*; the live raw markup is the *source of truth*. For each page, one at a time:

1. **Fetch** the raw markup with `content-items.get` (`context=edit`) and record `modified`.
2. **Check for drift.** The baseline Markdown is from `a5d34faa9` (fetched 2026-10-26); live pages were last modified around 2026-10-14, so there is no drift yet. Re-run `npm run verify -- --section wordpress-studio` (or compare `modified`) right before each update.
3. **Diff** the baseline Markdown against the edited Markdown to list the changed passages.
4. **Apply each change in place** to the block it came from: edit only the inner HTML, keep block comment delimiters and attributes. Callouts stay callouts, code blocks keep their block type, anchors and image attributes are preserved. New content uses core block markup.
5. **Check locally:**
   - Block delimiters are balanced.
   - Custom blocks (by name and attributes) are unchanged unless the change was intended.
   - Image IDs and URLs are intact.
   - No `<!-- TODO screenshot -->` notes from the Markdown leak into the content.
6. **Review:** show the before/after markup diff and wait for approval.
7. **Write** with `content-items.update` (`user_confirmed: true`), comparing `modified` immediately before writing, since there is no optimistic locking.
8. **Read back** and compare the stored content with what was sent, to catch stripping, and check `_content_warnings`.
9. **Verify** the live page; `npm run fetch` / `npm run verify` gives a Markdown view of the result. On approval move to the next page; otherwise roll back via wp-admin revisions.

An alternative to updating live pages directly is to stage each change as a draft `documentation` item, review its preview, then copy the approved markup to the live item. It adds a safety step but leaves draft items to clean up.

## Before starting

1. **Throwaway draft test.** Create a draft `documentation` item containing a callout and an `a8c-docs/syntax-highlighting` block, and check what survives save. This is a write to the public site (drafts aren't visible), so it needs a go-ahead.
2. **Scope.** Commit `39d57a0c6` changed 15 pages: agent-skills, blueprints/index, cli, debugging, FAQ, import-export, index, mcp-on-studio, php-runtimes, preview-sites, sites, ssl-in-studio, studio-code/index, sync, xdebug. Changelog, feedback and the custom-blueprints guide are unchanged.
3. **Screenshots.** Every changed page has `TODO screenshot` notes. Replacing an image means `media.upload`, then updating the image block's `id`, `src`/`href` and `wp-image-<id>` class. Decide whether that's a separate pass or part of each page update.
4. **SEO meta.** `advanced_seo_description` and `jetpack_seo_html_title` may need updating where a page's focus changed; both are writable through `content-items.update` as `meta`.
