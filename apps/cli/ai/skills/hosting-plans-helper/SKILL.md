---
name: hosting-plans-helper
description: Answer WordPress.com plan, pricing, upgrade, and feature-tier questions (plan names, what each tier unlocks — plugins, themes, custom code, SSH, hosting — and current prices) from authoritative live data. Load before answering ANY plan, pricing, or feature-gating question; never answer these from memory.
user-invokable: true
---

# Hosting Plans Helper

Use this skill whenever the user asks about WordPress.com (or Pressable) plans,
pricing, upgrades, or what a plan tier unlocks — for example "which plan do I need
for plugins?", "what does Business include?", "how much is Commerce?", "can I use
custom CSS on Premium?", or "should I upgrade?".

## Hard rule: never answer from memory

Plan names, prices, and feature-tier gating change, and your training data is stale.
You MUST fetch current data with this skill before answering. Do not state a plan
name, a price, or which tier unlocks a feature from memory — even if you are
confident. If the fetch fails, say you can't verify current plan data right now and
point the user to https://wordpress.com/pricing; do not guess.

## Step 1: Fetch plan names and features

Fetch `wpcom/v2/plans/pricing`. It returns, per plan, the current `name`, the
`product_slug` (used to look up the price in Step 2), and the full list of `features`
that tier unlocks — grouped (Essential features, Performance boosters, High
Availability, Developer tools, Security, etc.).

**Local sites (Bash tool available):**

```text
curl -s "https://public-api.wordpress.com/wpcom/v2/plans/pricing?locale=en"
```

**Connected WordPress.com sites (wpcom_request tool available, no Bash):**

```text
wpcom_request  method=GET  path="!/plans/pricing"  apiNamespace="wpcom/v2"
```

## Step 2: Fetch current prices

Fetch `wpcom/v2/products` for prices. It is keyed by product slug; each product has a
`cost_display` (the formatted, **already-localized** price, e.g. `"$300"`) and a
`currency_code`.

**Local sites:**

```text
curl -s "https://public-api.wordpress.com/wpcom/v2/products"
```

**Connected WordPress.com sites:**

```text
wpcom_request  method=GET  path="!/products"  apiNamespace="wpcom/v2"
```

Both endpoints are public (no authentication) and both are reachable in either
environment.

## Step 3: Answer from the fetched data only

- Use the exact plan **names** from Step 1 — do not rename or substitute legacy
  names.
- For a plan's **price**, look up `products[ plan.product_slug ].cost_display` and
  quote it as-is (it is already localized; mention the currency). The free plan has
  no price.
- To answer "does plan X include feature Y?" or "what do I need for Y?", check the
  per-plan `features` list from Step 1. Each feature has a `title`, a `tooltip` (use
  it to explain), and a `group`. Recommend the lowest tier whose `features` includes
  what the user needs.
- When recommending an upgrade, name the specific tier and the concrete features it
  unlocks for the user's stated goal.

## Scope

Currently covers the WordPress.com consumer plans (Free, Personal, Premium,
Business, Commerce). If the user asks about a plan or product not in the response
(e.g. Pressable, Woo Hosted, VIP, enterprise), say it's not covered by this data and
point them to https://wordpress.com/pricing rather than answering from memory.
