# Studio docs — verification findings

**Date:** 2026-08-19
**Scope:** `docs/developer-tools/studio/` vs <https://developer.wordpress.com/docs/developer-tools/studio/>
**Verdict:** Complete and exact. All 20 canonical live Studio pages are mirrored, and every one matches the live site byte-for-byte.

**Status update (2026-08-19):** the one gap found by this audit — `php-runtimes/` — has been fetched and verified. See [Resolved: `php-runtimes/`](#resolved-php-runtimes) for what changed and for a maintenance caveat about `build-manifest.mjs`.

---

## Method

1. **Content fidelity** — ran `node scripts/verify-section.mjs --section wordpress-studio`, which re-derives Markdown from the live DOM with the same Turndown port the site's "Copy page" button uses, then compares byte-for-byte against the local file.
2. **Coverage** — breadth-first crawl of the `/docs/developer-tools/studio/` subtree (24 URLs fetched), seeded from the section index and from every Studio URL in `sitemap-1.xml`. A URL counts as a real page only if it returns HTTP 200, is its own canonical, and renders the docs template (`.a8c-docs-entry__content`).
3. **Link integrity** — extracted all 21 unique `developer.wordpress.com/docs/` link targets from the mirrored Studio Markdown files and resolved each against the live site.

---

## Content fidelity — clean

**21 / 21 verified, 0 mismatches, 0 errors, 0 skipped.** Report: `reports/wordpress-studio-verify-report.json`.

That count is the `wordpress-studio` manifest section, which is 20 files under `docs/developer-tools/studio/` plus one cross-listed page — see [Note on the manifest section](#note-on-the-manifest-section) below.

Every page below is present and identical to live:

| Page | File |
| --- | --- |
| WordPress Studio | `index.md` |
| Studio sites | `sites.md` |
| Studio CLI | `cli.md` |
| Studio Code | `studio-code/index.md` |
| How AI Credits Work | `studio-code/ai-credits-guidelines.md` |
| Agent Skills in Studio | `agent-skills-wordpress-studio.md` |
| MCP in Studio | `mcp-on-studio.md` |
| Blueprints | `blueprints/index.md` |
| Open in WordPress Studio button | `blueprints/open-in-wordpress-studio-button.md` |
| Preview Sites | `preview-sites.md` |
| Studio Sync | `sync.md` |
| Import & export | `import-export.md` |
| SSL in Studio | `ssl-in-studio.md` |
| Debugging in Studio | `debugging/index.md` |
| Xdebug in Studio | `xdebug.md` |
| Frequently asked questions | `frequently-asked-questions.md` |
| Changelog | `changelog.md` |
| Feedback | `feedback/index.md` |
| Beta features | `feedback/beta-features.md` |
| PHP runtimes | `php-runtimes.md` |

Because `changelog.md` is time-sensitive, note that its verification is only as fresh as this report's date.

---

## Coverage — complete

The crawl found **20 canonical live pages** in the Studio subtree. All 20 are now mirrored.

### Resolved: `php-runtimes/`

This page was missing when the audit ran. It has since been added to `manifest.json`, fetched, and verified.

| | |
| --- | --- |
| **Title** | PHP runtimes |
| **Size** | ~1,990 words |
| **Subject** | Studio's two PHP runtimes — Native (default PHP binaries) and Sandbox (WordPress Playground WebAssembly binaries) — and how to choose between them |
| **Now at** | `docs/developer-tools/studio/php-runtimes.md` |
| **Linked from** | `docs/developer-tools/studio/sites.md:22` — a mirrored page, so this was a dangling reference inside the mirror |
| **Also linked from** | `developer-tools/studio/sites/` on the live site |

**Why it was missed:** `scripts/build-manifest.mjs` builds the page list solely from the sidebar nav (`nav[aria-label="Main Menu"]`). `php-runtimes/` is published and linked from body copy but is not listed in that sidebar, so it never entered `manifest.json` and was never fetched. It *is* present in `sitemap-1.xml`.

**Fix applied:** a `wordpress-studio` entry was inserted into `manifest.json` (after `studio/sites/`, `depth: 1`, `filePath: docs/developer-tools/studio/php-runtimes.md`), then `node scripts/fetch-section.mjs --section wordpress-studio` was run. Result: 21/21 downloaded, and a follow-up `verify-section.mjs` run reported 21/21 verified, 0 mismatches. Re-fetching the other 19 files produced no diff, which independently confirms the mirror is byte-stable.

> **Maintenance caveat.** `scripts/build-manifest.mjs` regenerates `manifest.json` from the sidebar nav alone. Because `php-runtimes/` is not in that nav, **re-running `npm run build-manifest` will silently drop this entry again.** Either re-add it after any manifest rebuild, or extend the script to union the nav with `sitemap-1.xml` and a `/docs/` link crawl.

---

## Link integrity

Of 21 unique `/docs/` link targets in the mirrored Studio files, 17 now resolve directly to a mirrored page. The other 4:

| Link target | Status | Linked from |
| --- | --- | --- |
| `studio/php-runtimes/` | Now mirrored — see above; was the one gap | `sites.md` |
| `studio/demo-sites/` | Redirects to `studio/preview-sites/` — mirrored | `index.md` |
| `studio/ssl/` | Redirects to `studio/ssl-in-studio/` — mirrored | `index.md` |
| `studio/roadmap/beta-features/` | Redirects to `studio/feedback/beta-features/` — mirrored | `feedback/index.md` |
| `developer-tools/studiofrequently-asked-questions/` | **404 upstream** — malformed on the live site (missing `/` before `frequently`) | `changelog.md`, `index.md` |

The three redirects are fine: the destination pages are mirrored, so no content is lost. The 404 is a broken link on WordPress.com's own site that the mirror reproduces faithfully — worth reporting upstream, but not a mirror defect.

With `php-runtimes/` fetched, no link in the Studio docs points at unmirrored content.

`studio/assistant/` also redirects to `studio/studio-code/` (already mirrored). It appears in the sitemap but is not linked from any mirrored page.

---

## Note on the manifest section

The `wordpress-studio` manifest section has 21 entries, but only 20 files live under `docs/developer-tools/studio/`. The extra entry is:

```
https://developer.wordpress.com/docs/guides/how-to-create-custom-blueprints/
  -> docs/guides/how-to-create-custom-blueprints.md
```

The Studio sidebar cross-links that page, which actually belongs to the Guides section. It is mirrored once, in the right place — this is correct behavior, not a duplicate, but it explains the 20-vs-19 discrepancy when auditing this directory.

---

## Summary

| Check | Result |
| --- | --- |
| Pages mirrored vs live canonical pages | 20 / 20 |
| Mirrored pages matching live content | 20 / 20 exact (21 / 21 including the cross-listed Guides page) |
| Internal `/docs/` links resolving to mirrored content | 20 / 21 (3 via redirect); 1 broken upstream, faithfully mirrored |
| Action required | None — but see the maintenance caveat on `build-manifest.mjs` above |
