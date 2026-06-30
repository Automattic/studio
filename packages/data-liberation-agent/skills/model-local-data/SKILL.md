---
name: model-local-data
description: Analyze an OWNED local static site's JavaScript data grids or repeated static-HTML content cards and emit a data-model.json that turns that data into real WordPress posts/taxonomy + native query loops while keeping the styling/animation/modal JS. Produces the model that liberate-local's convert step consumes. Use before liberate_convert_local_site when the source renders its content from JS data (catalogs, listings, galleries) or repeated post-preview cards in static HTML.
---

# Model local data → WordPress-driven data

Some hand-authored sites render their main content from **JavaScript data**: an empty container like `<div id="newestGrid"></div>` is filled at runtime by a mount call (`mountGrid('#newestGrid', newestObjets(4))`) that maps over an in-file array (`const OBJETS = [ … ]`). Others render repeated **content cards directly in static HTML**, such as a blog/archive index of post-preview cards. On a straight carry these grids are **empty or non-native in the block editor** — the data lives in JS or fixed HTML, not WordPress records.

This skill reads the source and produces a **`data-model.json`** describing how to make the data WordPress-driven: records + taxonomy + per-item meta, native `core/query` loops in place of the mounts/cards, and a faithful card render — while the source's styling, animation, filtering, and detail-modal JS keep running (reading WordPress data from per-card DOM islands).

The deterministic converter (`liberate_convert_local_site`) consumes the file; this skill only **authors the model by reading the source**.

---

## When it applies

Run this BEFORE `liberate_convert_local_site` when the source has any of:

- empty mount containers (`<div id="…">` / `<ul id="…">` with no children) filled by JS,
- an in-file data array of records (each with a stable id),
- a list/grid/catalog/gallery rendered by mapping that array to card markup,
- optionally a detail modal that looks an item up by id (`ARR.find(x => x.id === id)`).

It also applies when the source renders repeated **content cards directly in static HTML**, such as:

- a blog/archive index made of post-preview cards,
- repeated card links to article/detail pages,
- static category/date/excerpt/image card metadata that should become native WordPress posts and terms.

If the scaffold reports `discovered.source === 'none'`, no JS data array or repeated static-HTML content-card grid was found — skip straight to convert.

---

## How to produce it (scaffold-first)

1. **Run the deterministic scaffold.** Call `liberate_data_model_scaffold({ dir: "<source-dir>", outputDir: "<output-dir>" })`. It writes `<output-dir>/data-model.draft.json` (a partial `DataModel`) and returns `{ model, skillTodos, discovered, validation }`. The scaffold reports `discovered.source` as `js-array`, `html-cards`, or `none`. It has already extracted every record verbatim (`items[]`), enumerated `taxonomy.terms` and `fields[]`, linked the `mounts[]`, and set `sourceArrays` when JS arrays were found. The `discovered` summary lists which arrays were found/rejected and records dropped low-confidence/orphan containers under `discovered.unmatchedContainers` — if your data array or content-card grid is missing there, see the manual fallback.

   For `html-cards`, the scaffold derives `card.template` deterministically from the source card markup, so there is no `card.template` todo to resolve. Confirm only the flagged role/order todos. Bodies come from following each card's link; when multiple cards share a target, the linked page is the single template and the card bodies stay as excerpts. Static HTML cards register as core `post` records with native `category` terms, not a custom CPT, and convert neutralizes the card container into a native query loop.

   If `discovered.source === 'none'`, stop here: do not resolve todos or write `data-model.json`; fall through to the pure carry convert path.

2. **Resolve ONLY the `skillTodos`.** Each has a `path`, `instruction`, and source `evidence`. Do not re-author filled slots. Typical todos:
   - **`card.template`** (JS array path only) — rewrite the per-item card function (in `evidence`) into a single-root skeleton with `data-dla-*` bindings preserving the source classes. Grammar: `data-dla-text/attr/class/if`; `<expr>` = `'lit'` | `id` | `title` | `content` | `cat.slug` | `cat.label` | `meta.<key>` | `gallery.<n>.caption` | `map.<name>.<expr>`; `<cond>` = `<expr>` | `<expr>=='lit'` | `<expr>!='lit'`. Add value-keyed lookups (e.g. `CAT_TONE`) to `card.maps`.
   - **`mounts[i].query.order`** — confirm/adjust ordering + `perPage` (scaffold defaults to date/DESC). A full/all/complete catalog grid usually renders in source array order, so set `order: 'ASC'`; use `DESC` only for newest/recent/latest grids.
   - **`items[].id` / `items[].title` / `taxonomy`** — low-confidence role guesses; confirm or correct. If a value belongs in `meta`, move it (never drop it).
   - **`discovered.unmatchedContainers`** — check these low-confidence/orphan containers for any dropped grid before converting; add missing mounts only when the source proves they are content-driven.

3. **Validate and write.** Re-check that every `map.<name>`/`meta.<key>` the template references exists, item count == source record count, terms == the source's category set. Write the resolved model to `<output-dir>/data-model.json`. `liberate_convert_local_site` auto-activates the data path when that file is present.

## Manual fallback (if the scaffold tool is unavailable)

If `liberate_data_model_scaffold` is not registered (e.g. the MCP server hasn't restarted to pick it up) or errors, author `data-model.json` by hand: read the source JS or static card HTML, copy every record into `items[]` (id/title/content → as appropriate, category → `terms`, other fields → `meta`, image lists → `gallery`), enumerate `taxonomy.terms`, list `fields[]`, map each empty mount or repeated card container to a `query`, author `card.template` with the `data-dla-*` grammar above, and set `sourceArrays` when JS arrays were used. Never drop or summarize a record or field.

## Faithfulness rules

- Never drop or summarize a record or field. The card render runs server-side (frontend AND the editor query-loop preview), so the binding must reproduce the source card markup exactly. Surface honest gaps rather than inventing data.
