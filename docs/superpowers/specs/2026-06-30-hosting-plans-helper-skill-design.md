# Design: `hosting-plans-helper` skill

- **Issue:** [STU-1940](https://linear.app/a8c/issue/STU-1940) (bug: [STU-1939](https://linear.app/a8c/issue/STU-1939))
- **Date:** 2026-06-30
- **Status:** Approved design, pending implementation plan

## Problem

Studio Code answers WordPress.com plan, pricing, and feature-gating questions from
stale model-training knowledge. There is no authoritative source wired into the
agent, so it recommends renamed/legacy plans and makes incorrect feature-tier
claims (e.g. wrong plugin-tier gating). STU-1940 asks for a durable fix: a skill
that gives the agent current, authoritative plan/pricing/feature data instead of
relying on memory.

## Investigation findings (what shaped this design)

The issue proposed "fetch live from the `/plans` v1.5 API (`features_comparison`)."
Direct testing showed this premise does not hold for what Studio Code can reach:

- **`/plans` v1.5** (public and authenticated, v1.3/v1.5/v2, with/without the
  `features_comparison` param, and site-context): returns plan **names + prices**
  only. It carries **no general `features_comparison`**. Per
  [SHILL-1742](https://linear.app/a8c/issue/SHILL-1742), `features_comparison` was
  added **only for Woo Hosted plans in a Woo-Hosted site context** — not a general
  WordPress.com plans source.
- **Plan names** returned are the legacy lineup (Free/Personal/Premium/Business/
  Commerce). Flex/Pro/Premier are **not live** — not even on the production
  `/pricing` page yet — so legacy names are currently correct.
- **Prices** are live and geo/currency-localized via `/plans` `formatted_price`.

The real source of truth for "what each tier unlocks" is the **Landpack** plugin,
which renders the production `/pricing` page from curated PHP:

- `…/2023-pricing-grid/utilities/features.php` — `get_feature_labels()`: the
  grouped catalog mapping each feature key → `title`/`subtitle`/`tooltip`
  (Essential, Performance boosters, High Availability, Developer tools, Security,
  Grow, …).
- `…/utilities/plan-*.php` + `plan.php` `get_plans()` — each plan's resolved
  `name` (from the `/plans` store product), `slug`, feature-key lists, `storage`,
  `ai_assistant_limit`, commission %, etc.

The existing public `wpcom/v2/plans/mobile` endpoint exposes a similar but coarser,
partly-stale shadow of this (37 flat features, missing dev/host granularity like
SSH/staging/git/CDN; e.g. it reports Business = 200GB while Landpack says 50 GB).
It is not a good long-term foundation.

**Conclusion:** names + prices come from `/plans` (live); the rich per-tier feature
data exists only in Landpack (server-side). To make it queryable, we expose Landpack
through a new, purpose-built REST endpoint.

## Design overview

Two coordinated pieces, in two repositories.

```
[Landpack PHP]  get_plans() + get_feature_labels()
       │  (server-side, same source the /pricing page renders)
       ▼
[wpcom]  GET wpcom/v2/plans/pricing   ← Piece 1 (new, public, normalized DTO)
       │
       ▼  (agent fetches: curl in local mode, wpcom_request in remote mode)
[Studio]  hosting-plans-helper skill  ← Piece 2 (SKILL.md + system-prompt guardrail)
       │
       ├─ /plans/pricing → names + per-tier features
       └─ /plans         → live, geo-correct prices (merged by slug)
       ▼
   Agent answers from current data, never from memory
```

## Piece 1 — wpcom endpoint: `GET wpcom/v2/plans/pricing`

> **Authoritative spec:** `2026-06-30-plans-pricing-endpoint-design.md` (standalone,
> built in the `Automattic/wpcom` repo). The summary below is for context; defer to
> that spec for the endpoint contract.

- Added to the existing `WPCOM_REST_API_V2_Endpoint_Plans` controller
  (`wp-content/rest-api-plugins/endpoints/plans.php`), alongside `/plans/mobile`.
- **Public**, no authentication (so both Studio modes can reach it). Accepts
  `?locale=` (default `en`), mirroring `/plans/mobile`.
- Reads `Landpack\get_plans()` and `Landpack\get_feature_labels()` — the same
  source the `/pricing` page renders — so it **cannot drift** from what users see.
- Resolves feature keys → `{ key, title, tooltip, group }` server-side and returns
  a **normalized DTO**, dropping presentation-only fields (badges, CTA buttons,
  icons, `features_v4/v5` card selections).
- **No prices** in this endpoint — kept single-purpose; the skill fetches `/plans`
  for prices.
- **Scope:** the 5 consumer plans only — Free, Personal, Premium, Business,
  Commerce. (Landpack `get_plans()` also returns VIP; excluded from v1.)

### Response shape

```json
{
  "source": "landpack",
  "locale": "en",
  "plans": [
    {
      "slug": "business",
      "name": "Business",
      "storage": "50 GB",
      "ai_assistant_limit": "Enhanced",
      "features": [
        {
          "key": "dev-tools-ssh",
          "title": "SSH access",
          "tooltip": "Securely access your site over SSH.",
          "group": "Developer tools"
        }
      ]
    }
  ]
}
```

(Exact per-plan scalar fields — `storage`, `ai_assistant_limit`, commission — to be
finalized in the plan against what `plan_defaults()` actually exposes.)

### Risks / to verify during implementation

- **Loadability:** confirm Landpack pricing-section utils are `require`-able in the
  REST request context (they are normally loaded for block render). The endpoint
  must bootstrap them before calling `get_plans()`/`get_feature_labels()`.
- **Coupling:** the endpoint depends on Landpack internal functions; a Landpack
  refactor of `get_plans()` would break it. Mitigate with a **contract test** on the
  endpoint response (asserts the 5 plans + non-empty grouped features + the DTO
  shape).
- **Ownership:** lives in `Automattic/wpcom` — needs a wpcom owner, review, and
  deploy. This is a separate repo from Studio.

## Piece 2 — Studio skill: `hosting-plans-helper`

- New skill at `apps/cli/ai/skills/hosting-plans-helper/SKILL.md`, discovered by the
  existing `loadSkills()` mechanism. Frontmatter: `name`, `description`,
  `user-invokable: true`.
- **Skill-only** (no dedicated tool, no bundled snapshot). The agent performs the
  fetch with the tools it already has.
- The SKILL.md instructs the agent, **before answering any plan/pricing/feature/
  upgrade/"what does tier X unlock" question**, to:
  1. Fetch names + features + `product_slug` per plan from `wpcom/v2/plans/pricing`.
  2. Fetch prices from `wpcom/v2/products` (keyed by product slug; `cost_display` is
     already localized) and join by `product_slug`.
  3. Answer only from the fetched data — never state names, prices, or feature-tier
     gating from memory.
- **Both endpoints are `wpcom/v2` and public**, so the same two calls work in both
  tool environments:
  - **Local mode** (local sites): has `Bash`, no `wpcom_request`. Fetch via
    `curl ".../wpcom/v2/plans/pricing?locale=en"` and `curl ".../wpcom/v2/products"`.
  - **Remote mode** (connected WP.com site): has `wpcom_request`, no `Bash`. Fetch
    via `wpcom_request` `path="!/plans/pricing"` and `path="!/products"`, each with
    `apiNamespace="wpcom/v2"`.
- **Why `wpcom/v2/products` for prices** (not `/plans` v1.5): `wpcom_request` (the
  only remote-mode fetch tool) supports `wp/v2` / `wpcom/v2` / v1.1 — not v1.5;
  reachable alternatives lack WP.com bundle prices (`rest/v1.1/plans` 404s,
  `wpcom/v2/plans` is the Jetpack family). `wpcom/v2/products` is reachable in both
  modes and already localized.

### System-prompt guardrail

In `apps/cli/ai/system-prompt.ts`, add a guardrail directing the agent **not** to
state plan names, prices, or feature-tier gating from memory, and to load the
`hosting-plans-helper` skill (or fetch current data) first. Add it to:

- `LOCAL_SKILL_ROUTING` (local intro), and
- the remote intro (`buildRemoteIntro`), which already gates design features by plan.

## Sequencing & dependency

Because v1 is **live-endpoint-only** (no bundled fallback), the Studio skill is
**non-functional until `wpcom/v2/plans/pricing` is deployed**. Implementation order:

1. Build + test + deploy the wpcom endpoint (Piece 1).
2. Build the Studio skill + guardrail (Piece 2) against the live endpoint.

The skill should fail gracefully if the endpoint is unreachable (tell the user it
can't verify current plan data rather than answering from memory).

## Testing

- **Endpoint:** contract test asserting the 5 consumer plans, non-empty grouped
  features with resolved titles/tooltips, and the documented DTO shape.
- **Skill:** unit coverage that the skill is discovered/loaded (`loadSkills`) and is
  `user-invokable`; the existing `system-prompt.test.ts` extended to assert the
  guardrail text is present in both local and remote prompts.
- **Manual:** run a plan/feature question through Studio Code (local and remote) and
  confirm answers come from the endpoint, with correct current names and live prices.

## Out of scope (v1)

- Pressable, WooCommerce, and VIP plans (same mechanism can extend later).
- A bundled fallback snapshot of plan data.
- A dedicated `get_hosting_plans` Studio tool (caching / uniform shape) — could be a
  later robustness upgrade if skill-only fetching proves flaky.
- Sharing the mechanism with Odie/Wapuu (the endpoint is reusable by them, but that
  integration is not part of this work).
