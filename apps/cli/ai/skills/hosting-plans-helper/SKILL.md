---
name: hosting-plans-helper
description: Answer WordPress.com plan and feature-tier questions (plan names and what each tier includes — plugins, themes, custom code, SSH, hosting) from authoritative live data. Load before answering ANY plan or feature-gating question; never answer these from memory.
user-invokable: true
tools: wpcom_request
---

# Hosting Plans Helper

Use this skill whenever the user asks about WordPress.com (or Pressable) plans or
what a plan tier includes — for example "which plan do I need for plugins?", "what
does Business include?", or "can I use custom CSS on Premium?".

## Hard rule: never answer from memory

Plan names and feature-tier gating change, and your training data is stale. You
MUST fetch current data with this skill before answering. Do not state a plan name
or which tier unlocks a feature from memory — even if you are confident. If the
fetch fails, say you can't verify current plan data right now and point the user to
https://wordpress.com/pricing; do not guess.

## Step 1: Fetch plan names and features

Fetch `wpcom/v2/plans/features`. It returns, per plan, the current `name` and the
full list of `features` that tier unlocks — grouped (Essential features,
Performance boosters, High Availability, Developer tools, Security, etc.).

**Local sites (Bash tool available):**

```text
curl -s "https://public-api.wordpress.com/wpcom/v2/plans/features?locale=en"
```

**Connected WordPress.com sites (wpcom_request tool available, no Bash):**

```text
wpcom_request  method=GET  path="!/plans/features"  apiNamespace="wpcom/v2"
```

The endpoint is public (no authentication) and reachable in either environment.

## Step 2: Answer from the fetched data only

- Use the exact plan **names** from Step 1 — do not rename or substitute legacy
  names.
- To answer "does plan X include feature Y?" or "what do I need for Y?", check the
  per-plan `features` list from Step 1. Each feature has a `title`, a `tooltip` (use
  it to explain), and a `group`. Name the plans whose `features` include it.

### Phrasing

Answer directly and authoritatively, as plain product knowledge. Do not mention that
you fetched anything, or reference "the live data", "the data I fetched", "according
to the API", or any source or tool. The fetched data is simply the truth — state it.

- Yes: "Plugins are supported on the Personal plan and above."
- No: "Based on the live data I just fetched, plugins are supported on Personal and
  above."

## Scope

Currently covers the WordPress.com consumer plans (Free, Personal, Premium,
Business, Commerce). If the user asks about a plan or product not in the response
(e.g. Pressable, Woo Hosted, VIP, enterprise), say it's not covered by this data and
point them to https://wordpress.com/pricing rather than answering from memory.
