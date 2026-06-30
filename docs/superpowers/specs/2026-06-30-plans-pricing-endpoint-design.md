# Design: `GET wpcom/v2/plans/pricing` endpoint

- **Repo:** `Automattic/wpcom` (NOT the Studio repo — this is the backend piece)
- **Consumer:** Studio Code `hosting-plans-helper` skill
  ([STU-1940](https://linear.app/a8c/issue/STU-1940)); see the companion Studio spec
  `2026-06-30-hosting-plans-helper-skill-design.md`.
- **Date:** 2026-06-30
- **Status:** Spec for implementation (standalone — an agent can build from this alone)

## Goal

Expose the WordPress.com `/pricing` plan + per-tier feature data — currently
rendered server-side by the Landpack plugin and not available through any general
API — as a small, public, normalized REST endpoint, so AI assistants (Studio Code
first; Odie/Wapuu reusable later) can fetch authoritative "what each plan unlocks"
data instead of relying on stale model knowledge.

This endpoint **includes a `price` per plan**. Although `/plans` (v1.5) is the usual
price source, it is unreachable from Studio Code's remote mode: the only fetch tool
there (`wpcom_request`) supports the `wp/v2`, `wpcom/v2`, and v1.1 namespaces — not
v1.5 — and the reachable alternatives don't carry WordPress.com bundle prices
(`rest/v1.1/plans` 404s; `wpcom/v2/plans` returns the Jetpack plan family, not the
hosting bundles). Since `plan_defaults()` already loads the store product (which
holds the price), exposing it here lets a single `wpcom/v2` call serve names,
features, **and** prices in both local and remote modes.

## Why this source

The existing `/plans` (v1.x) API returns plan **names + prices** but **no general
per-tier feature data** (`features_comparison` exists only for Woo Hosted plans in a
Woo-Hosted site context, per [SHILL-1742](https://linear.app/a8c/issue/SHILL-1742)).
The existing public `wpcom/v2/plans/mobile` endpoint has a coarse, partly-stale
feature list (e.g. it reports Business = 200GB; Landpack says 50 GB; it lacks
SSH/staging/git/CDN granularity).

The authoritative source — the one the production `/pricing` page renders from — is
the Landpack plugin. Reading it directly means the endpoint **cannot drift** from
what users see on `/pricing`, with no second copy to maintain.

## Source functions (Landpack)

All in the Landpack plugin under:
`wp-content/plugins/landpack/src/blocks/pricing-section/themes/2023-pricing-grid/utilities/`

- `Landpack\get_plans()` (`plan.php`) — returns a keyed array of plan configs:
  `free`, `personal`, `premium`, `business`, `ecommerce`, `vip`. Each value is the
  output of `Plan_*::plan_defaults()`.
- `Landpack\get_feature_labels()` (`features.php`) — the **grouped** catalog: an
  array of 8 groups, each:
  ```php
  [ 'title' => 'Developer tools', 'features' => [
      'dev-tools-ssh' => [ 'title' => 'SSH access', 'tooltip' => '…', /* subtitle?, jetpack?, hide_in_comparison_grid? */ ],
      … ] ]
  ```
- `Landpack\get_feature_labels_ungrouped()` (`features.php`) — same data flattened to
  `[ '<key>' => [ 'title' => …, 'tooltip' => … ] ]` (loses group association).

### Relevant fields on each `plan_defaults()` result

- `slug` — e.g. `business`.
- `title` — display name, resolved live from the `/plans` store product
  (`$store_product->product_name_short`).
- `subtitle` — short tagline.
- `features_compare_annual` / `features_compare_month` — **arrays of feature keys**
  (strings) — the comprehensive comparison-grid inclusion lists. `annual` =
  `month` + a few annual-only extras (free domain, support). **Use `annual` as the
  canonical inclusion list.**
- `features_compare_conditional` — extra store/Woo rows (relevant to Commerce).
- `features_v4` / `features_v5` — highlighted card features (a resolved subset; not
  the full inclusion list). Not needed for this endpoint.
- `storage` — e.g. `50 GB`.
- `ai_assistant_limit` — e.g. `Enhanced`.
- `standard_commission` / `woo_commission` — e.g. `2%` / `0%`.

## Endpoint definition

- **File:** `wp-content/rest-api-plugins/endpoints/plans.php` — add to the existing
  `WPCOM_REST_API_V2_Endpoint_Plans` controller (same file/class as
  `/plans/mobile`).
- **Route:** register `wpcom/v2/plans/pricing` in `register_routes()`.
- **Method:** `GET` (`WP_REST_Server::READABLE`).
- **Auth:** **public** (no auth) — Studio Code reaches it unauthenticated in both
  local (curl) and remote (`wpcom_request`) modes. Matches `/plans/mobile`.
- **Args:** `locale` (default `en`), handled with `wpcom_switch_to_locale(...)` like
  `get_plans_mobile()`; `currency` (optional) for the price field, defaulting to the
  request's geo/store default as `/plans` does.
- **Callback:** `get_plans_pricing( $request )`.

## Algorithm

1. `wpcom_switch_to_locale( $request->get_param( 'locale' ) )`.
2. Ensure Landpack pricing-section utilities are loaded (see "Loadability" below);
   then build a key → label map **with group** by iterating the grouped
   `Landpack\get_feature_labels()`:
   ```
   foreach group:
     foreach (key => label) in group['features']:
       map[key] = { title: label['title'], tooltip: label['tooltip'] ?? '', group: group['title'] }
   ```
3. `$plans = Landpack\get_plans();`
4. For each of the **5 consumer plans** (`free, personal, premium, business,
   ecommerce`) — exclude `vip`:
   - Take `features_compare_annual` (fall back to `features_compare_month` if annual
     is unset). For Commerce, also append `features_compare_conditional`.
   - Resolve each key through `map`; **skip unknown keys** (a key present in a plan
     list but absent from the catalog — mirror the `isset` guard in
     `process_features_v4`). De-duplicate keys (a few plans list a key twice).
   - Emit `{ key, title, tooltip, group }` per resolved feature, preserving the
     catalog's group order.
   - Carry scalar fields: `name` (= `title`), `slug`, `tagline` (= `subtitle`),
     `price` (formatted, currency-aware, from the store product — the same source
     `/plans` uses; `null`/omitted for Free), `currency`, `storage`,
     `ai_assistant_limit`, `standard_commission`, `woo_commission`.
5. Return the DTO below.

## Response shape (normalized DTO)

```json
{
  "source": "landpack",
  "locale": "en",
  "plans": [
    {
      "slug": "business",
      "name": "Business",
      "tagline": "Grow your business with powerful tools and priority support.",
      "price": "$300",
      "currency": "USD",
      "storage": "50 GB",
      "ai_assistant_limit": "Enhanced",
      "standard_commission": "2%",
      "woo_commission": "0%",
      "features": [
        { "key": "unlimited-pages", "title": "Unlimited pages", "tooltip": "Add as many pages as you like to your site.", "group": "Essential features" },
        { "key": "dev-tools-ssh",   "title": "SSH access",      "tooltip": "…", "group": "Developer tools" }
      ]
    }
  ]
}
```

- Plans ordered: Free, Personal, Premium, Business, Commerce.
- No presentation fields (badges, CTA buttons, icons, `features_v4/v5`).

## Loadability (verify during implementation)

The Landpack util functions are normally loaded when the pricing-section block
renders, not on every request. The endpoint must make them available before calling:

1. Prefer a guard: `if ( ! function_exists( 'Landpack\\get_plans' ) ) { require_once <path>/plan.php; }` — `plan.php` itself `require`s `features.php` and all `plan-*.php`.
2. Confirm `plan.php`'s own relative `require`s (e.g. `../../../../../utilities/get-currency.php`) and its calls into WPCOM (`get_store_product`, `wpcom_switch_to_locale`) resolve in REST request context.
3. If direct loading proves fragile, the fallback is to replicate the small amount
   of Landpack logic behind a Landpack-owned accessor — but **prefer reusing the
   functions** so the data stays in lockstep with `/pricing`.

## Error handling

- If Landpack functions cannot be loaded or `get_plans()` returns empty, return a
  `WP_Error` (HTTP 500) with a clear code (e.g. `landpack_unavailable`) rather than a
  partial/empty `plans` array — so consumers can detect failure and refuse to answer
  from memory rather than present wrong data.

## Testing

Contract test asserting:
- HTTP 200, public (works unauthenticated).
- `plans` has exactly the 5 consumer slugs in order; no `vip`.
- Each plan has non-empty `features`, every feature has non-empty `title` and a
  `group`, and `key`s are unique within a plan.
- A spot-check that a known Business-only developer feature (e.g. `dev-tools-ssh` /
  staging) is present on `business`/`ecommerce` and absent on `free`/`personal`.
- `locale` param is honored (a non-`en` locale changes localized titles).
- Each paid plan has a non-empty `price` and `currency`; `currency` param is honored.

## Scope / out of scope

- **In:** the 5 consumer WordPress.com plans; grouped per-tier features; the scalar
  fields listed above including `price`; `locale` and `currency`.
- **Out:** VIP/Blogger/DIFM; Pressable; Woo Hosted; any write/POST; auth/site-context
  personalization.
