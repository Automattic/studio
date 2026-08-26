---
name: liberate
description: Import and rebuild a website from a closed platform (Wix, Squarespace, Webflow, Shopify, GoDaddy, Hostinger, HubSpot, Weebly) — or from a local directory of the user's own HTML/CSS/JS (a static-site export) — into a Studio WordPress site. Extracts pages/posts/products + media, then reconstructs the design as editable blocks + WooCommerce OR as a high-fidelity replica theme. Invoke when the user wants to migrate, import, liberate, or rebuild a site from one of these platforms or from a local folder.
---

# Liberate a website into Studio

This skill is only a **redirect**. The real, always-up-to-date pipeline lives in the Data Liberation engine's own skill. Do NOT re-plan or summarize the steps here — defer to the engine skill so its updates take effect automatically. Your job is just to (1) stand the engine up and (2) follow its skill, translating its tool calls into Studio's bridge.

## Step 1 — Locate the engine

Call the `data_liberation` tool with `{ tool: "setup" }`. It returns `{ engineDir, liberateSkill, skillsDir }` — the paths to the engine's skill files. The engine ships prebuilt with Studio, so this is instant — just proceed.

## Step 2 — Load the engine's tool catalog

Call `data_liberation` with `{ tool: "list" }` to load the engine's full tool catalog (every tool name + its argument JSON-Schema). Treat that catalog as the **source of truth** for tool names and arguments — the engine skill names the tools to call, but the catalog tells you their exact arguments. If you are ever unsure of an argument, re-read the catalog rather than guessing.

## Step 3 — Follow the engine's real liberate skill

`Read` the `liberateSkill` path from Step 1 (the engine's own `SKILL.md`) and execute its workflow verbatim, applying these Studio bindings wherever it instructs you:

- **Engine tool call** — where it says "call the `liberate_X` tool with `{…}`", instead call Studio's `data_liberation` tool with `{ tool: "liberate_X", args: {…} }` and read the returned text/JSON as that tool's result. (`args` is a JSON **object**, never a stringified JSON.)
- **Sub-skill dispatch** — where it dispatches another skill (e.g. `replicate-with-blocks` / `replicate-theme` / `liberate-local`), `Read` it under `engineDir/skills/<name>/SKILL.md` and continue inline with these same bindings.
- **Local-directory input** — the engine skill's routing step dispatches `liberate-local` when the input is a local folder of HTML rather than a URL. Its bindings differ from the URL path: provisioning + conversion go through `liberate_convert_local_site` (with `createSite: true`), and admin creds come from the `WP_ADMIN_USER` / `WP_ADMIN_PASS` env vars — the `liberate_preview` / application-password guidance in the next bullet applies to the URL path only.
- **Install & import (URL path)** — follow the engine's install step (it documents both `liberate_preview` and `liberate_install_theme` + `liberate_import`); `/liberate` is the engine's *standalone* context, so prefer **`liberate_preview`** (one call: creates the Studio site, imports the WXR + media, runs WP-default cleanup, activates the theme). Two Studio specifics the engine can't know: (1) `liberate_import` needs credentials — create an application password with `studio wp user application-password create` and pass it; (2) never point `studio wp import` / `wp eval-file` at the host `_liberations` path — Studio's PHP sandbox only reads inside the site (`/wordpress/...`), so let `liberate_preview` / `liberate_import` do the import rather than hand-rolling it.
- **Don't skip the final QA** — it's nested a level deeper and easy to stop short of after a long run. The chosen sub-skill ends with a mandatory parity step: **blocks** → `Read` `engineDir/skills/design-qa/SKILL.md` and complete its loop; **theme** → `replicate-theme`'s `liberate_compare` step. Run it fully; never substitute eyeballed screenshots, and honor the engine's honesty rule — no "looks good / matches" without measured parity.
- **`liberate_blockify_wxr`** — if it reports "no platform recorded", re-call with the platform from `liberate_detect` (e.g. `{ platform: "wix" }`); a no-op on platforms without a block recipe is expected, not a failure.
- **Timeouts (`MCP error -32001`) mean "still working," not "failed."** Any engine op can return `-32001` on the client side while it keeps running **inside the engine** — never treat it as a failure and never blindly re-invoke (a re-invoke often errors, e.g. `extraction already in progress`). For extraction/reconstruct ops (`liberate_extract`, `liberate_screenshot`, reconstruct), poll `liberate_status` with `{ outputDir }` until `running` is `false`, then continue from the output artifacts. For any other op that times out, wait and re-check its output/state before concluding it failed.

## Reporting

When the engine finishes, summarize its run report: the Studio site built into, the reconstruct path taken, counts (pages/posts/products/media), the parity/verdict, and anything flagged for manual attention.
