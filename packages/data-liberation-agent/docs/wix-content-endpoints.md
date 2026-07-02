# Wix authenticated content endpoints

The ten load-bearing endpoints a logged-in Wix editor or dashboard tab
hits to read site content the public renderer doesn't expose: drafts,
unpublished products, contacts, members, form submissions, bookings,
blog drafts and full Ricos source, full-resolution media originals,
and hidden / password-protected pages.

This is a content reference. For Wix's auth scheme, window globals,
and infrastructure endpoints (account, premium status, feature flags,
etc.), see the 2026-03-31 *Wix Dashboard API reverse engineering via
CDP* entry in [`DISCOVERIES.md`](../DISCOVERIES.md).

URLs are stable in shape across 2024–2026. Wix versions routes
constantly (`v1` → `v2` → `v4`) and A/B-routes the same call through
different hostnames — match on path substrings, not exact URLs.

## CMS — Data Collections (items)

- **URL:** `https://editor.wix.com/_api/cloud-data/v2/items/query?.r=<base64url>`
  Variants: `/items/count`, `/items/update` (POST).
- **Method:** GET. Parameters packed into the `.r` query string as
  base64url-encoded JSON.
- **Draft inclusion (the key unlock):** the request must set both
  `environment: "SANDBOX_PREFERRED"` AND
  `publishPluginOptions.includeDraftItems: true`. `"LIVE"` returns
  published items only — the slice public scraping sees.
- **Pagination:** offset-based (`paging.offset`, `paging.limit`).
  Self-throttled to `limit: 50` even though docs quote 100.
- **Image URIs:** `IMAGE`-typed fields return
  `wix:image://v1/<hash>~mv2.jpg/<filename>#originWidth=N&originHeight=N`.
  Resolve to `https://static.wixstatic.com/media/<hash>.jpg` (drop the
  `~mv2.jpg` segment).
- **System fields on every item:** `_id`, `_owner`, `_createdDate`,
  `_updatedDate`, `_publishStatus` (`PUBLISHED` / `DRAFT`),
  `_publishDate`, `_draftDate`.
- **Public scraping misses:** every draft item, every field public
  templates don't render, private collections.

## CMS — Collections schema

- **URL:** `https://editor.wix.com/_api/cloud-data/v2/collections?paging.offset=0&consistentRead=true&includeAllowedDataPermissions=true`
- **Response:** single payload describing every collection on the
  site. Per-collection: `id`, `collectionType` (`WIX_APP` / custom),
  `displayName`, `displayField`, `fields[]` with `key`,
  `displayName`, `type` (`TEXT` / `NUMBER` / `URL` / `MULTI_REFERENCE`
  / `IMAGE` / ...), `capabilities.sortable`,
  `capabilities.queryOperators`.
- **Why call first:** every items query needs schema to know which
  fields exist, which are references, which are images needing URI
  resolution.
- **Companion count:** `POST /_api/autocms-server/v1/batch/collections/count`.

## Contacts

- **URL:** `https://www.wixapis.com/contacts/v4/contacts/query` (POST),
  `/{id}` (GET).
- **Response:** `{ contacts: [{ id, info: { name, emails, phones,
  addresses, labels, extendedFields }, primaryInfo, source,
  createdDate, updatedDate }] }`.
- **Public scraping misses:** the entire CRM — every contact from
  forms, chat, subscriptions.
- **Gotcha:** `extendedFields` are keyed by internal slug; need a
  separate `GET /contacts/v4/extended-fields` call to map slug →
  display name. Pagination via `paging.cursor`.

## Members

- **URL:** `https://www.wixapis.com/members/v1/members/query` (POST),
  `/{id}` (GET). Requires Members app installed.
- **Response:** `{ members: [{ id, contactId, loginEmail, status,
  profile: { nickname, slug, photo, title, ... }, privacyStatus }] }`.
- **Public scraping misses:** member identity, profile data, and
  privacy state. Passwords are not exfiltrable, but WP users can be
  recreated from this.
- **Gotcha:** always cross-reference `contactId` to the Contacts API —
  the full PII lives there, not on the Member.

## Stores — products with variants

- **URL:** `https://www.wixapis.com/stores-reader/v1/products/query`
  (POST), legacy `https://www.wixapis.com/stores/v1/products/query`.
  Variants: `/products/{productId}/variants/query` (POST).
- **Response:** `{ products: [{ id, name, slug, description, price,
  sku, ribbon, stock, media, productOptions, manageVariants,
  variants?, collectionIds, additionalInfoSections }] }`.
- **Public scraping misses:** unpublished products, the full variant
  Cartesian, internal SKU / barcode / cost, stock quantities.
- **Gotchas:**
  - When `manageVariants: false`, the top-level price is authoritative.
  - When `manageVariants: true`, you must call the variants endpoint
    per product — variants are NOT included inline in the products
    list.
  - Large stores rate-limit at ~10 QPS; batch with ~500 ms gaps.

## Forms — submissions

- **URL:** `https://www.wixapis.com/_api/wix-forms/v4/submissions/query`
  (POST). Sometimes proxied through
  `editor.wix.com/_api/wix-forms-app/v1/submissions`.
- **Response:** `{ submissions: [{ id, formId, submitter, submissions:
  { field-key: value }, status, createdDate }] }`.
- **Public scraping misses:** every submission ever. The public HTML
  shows form *definition*; submissions live only in the dashboard.
- **Gotcha:** Wix has shipped three forms products (classic Contact
  Forms, Wix Forms app, newer Native Forms). Endpoint differs per
  product. Field schemas live at a separate
  `GET /wix-forms/v4/forms/{formId}` →
  `{ fields: [{ target, label, type, validation }] }` — the `target`
  is the key inside each submission.

## Bookings

- **URL:** `https://www.wixapis.com/bookings/v2/{bookings,services,slots}/query`
  (POST).
- **Response (services):** `{ services: [{ id, name, type:
  APPOINTMENT|CLASS|COURSE, schedule, payment, staffMemberIds,
  locations, form }] }`.
- **Public scraping misses:** every booking, service config, staff
  and location bindings.
- **Gotchas:** the three booking types map to very different WP
  structures. The pagination cursor on bookings is shallow — for
  historical export, time-range filter + re-query is safer.

## Blog — drafts and full body

- **URL:** `https://www.wixapis.com/blog/v3/posts/query` (POST).
  Drafts: `/draft-posts/query`.
- **Response:** `{ posts: [{ id, title, excerpt, slug,
  firstPublishedDate, url, coverMedia, memberId, categoryIds, tagIds,
  richContent: { nodes: [...] } }] }`.
- **Public scraping misses:** drafts, scheduled posts, members-only
  posts, and the full Ricos `richContent` JSON. The public HTML is a
  *render* of the Ricos tree — having the source produces much higher
  fidelity migrations.
- **Gotcha:** two URL shapes seen live — `/blog/v3/*` on `wixapis` and
  `/_api/communities-blog-node-api/...` on the editor proxy. Capture
  both; metadata field names differ.

## Media Manager — full-resolution originals

- **URL:** `https://www.wixapis.com/site-media/v1/files/search` (POST),
  `/files/{fileId}/download-url` (GET).
- **Response (search):** `{ files: [{ id, displayName, mimeType,
  sizeInBytes, mediaType, url, parentFolderId, labels, namespace,
  operationStatus }] }`.
- **Response (download-url):** `{ downloadUrl, expires }` — **signed
  URL, ~10 minute expiry.**
- **Public scraping misses:** the originals. Public pages serve resized
  derivatives via `static.wixstatic.com/media/...` with `w_` / `h_` /
  `q_` transforms.
- **Gotcha:** signed-URL expiry is brutal. Fetch immediately or
  persist the URL with a `fetchBy` timestamp and re-request before
  expiry.

## Site structure — pages, menus, published state

- **URL:** `https://www.wixapis.com/site-content/v1/site-structure`
  (GET), `/pages/v1/pages/query` (POST), menus:
  `/menus/v1/menus/query` (POST).
- **Response (site-structure):** `{ pages: [{ id, title, url,
  pageType, seoData, hidden, password-protected, publishState }],
  menus, homePage }`.
- **Public scraping misses:** hidden pages, password-protected pages
  (you see they exist + URL, not contents), draft-only pages, menu
  hierarchy as configured.
- **Gotcha:** `site-structure` returns top-level pages only. Blog
  posts, product pages, etc. are virtual pages — use their own
  endpoints above.

## Bonus content-adjacent endpoints

- `/email-marketing/v1/campaigns/query` — campaigns and subscriber
  lists.
- `/seo-reporter/v1/...` — per-page SEO settings.
- `/analytics-reporter/v1/...` — traffic and conversion data.

## Cross-cutting content gotchas

- **Pagination styles vary.** Newer Wix APIs use opaque cursor strings
  (`paging.cursor`); older use `paging.offset` / `paging.limit`.
- **Rate limits.** ~10 req/s/user observed on `wixapis.com`.
- **Editor-document parsing.** `editor-document-store/v1/document`
  returns a `fixer`-encoded actions feed (not a pages tree).
  Materialising pages from it requires Wix's own migration-fixer
  library — preserving it as opaque is a reasonable baseline.
