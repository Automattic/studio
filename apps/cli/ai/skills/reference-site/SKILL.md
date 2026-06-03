---
name: reference-site
description: See and learn from an external website the user references by URL — screenshot it and read its content to brief design and copy. Use when the user links a site as visual inspiration, names a real org by its URL, points at a content source, or names a competitor to match or contrast.
user-invokable: true
---

# Reference Site

When the user references an existing website, look at it before you build. A screenshot plus a content read turns a vague pointer ("a candy shop like gumroad.com", "build a site for lhab.org") into a concrete brief that shapes layout, palette, typography, and copy.

Use the reference as **inspiration, not a clone target**. Capture its energy, structure, and vocabulary; do not reproduce it pixel-for-pixel or lift its copy verbatim.

## When to use

Load this skill when the prompt references an external site by URL under any of these framings:

- **Visual inspiration** — "make it look like stripe.com", "inspiration: https://example.com".
- **Subject identity** — the URL *is* the thing the site is about: "build a website for lhab.org". Without looking, the model free-associates from the letters and gets it wrong.
- **Content source** — "base the about page on the copy at acme.com/about".
- **Competitor / contrast** — "like notion.com but warmer", "we compete with basecamp.com".

**Require an actual URL.** A bare brand name with no domain ("like Amazon") is NOT a reference — do not guess a URL. "like amazon.com" IS a reference. If the user clearly means a site but gives no URL, ask for it rather than inventing one.

## How to build the brief

Two reinforcing inputs. Run both when a URL is present; either one alone is still useful.

1. **Visual brief — `take_screenshot`.** A single `viewport: "desktop"` shot is enough — design language (palette, type, hero treatment, section rhythm) lives above and just below the fold. Don't request `viewport: "all"` or paginate a tall reference with `offset`; reference sites are often many thousands of pixels tall, and the extra slices add payload without adding signal. From the image, note: palette (dominant + accent colors), typography (display vs. body character), layout rhythm (section structure, density, alignment, full-bleed vs. contained), signature components (marquees, scroll rows, layered cards, asymmetric color blocks, sticker/overlay treatments), and overall mood.
2. **Content brief — `fetch_webpage`.** Read the URL's text to learn: identity (what the org is), audience (who it's for), what they do, voice/tone, and anchor terms (the vocabulary the new site should use). `fetch_webpage` only reads public http(s) URLs and may return nothing for single-page apps or bot-blocked sites — that's fine, degrade to the visual brief alone.

State the brief compactly in your own words before writing files, then fold it into the design direction alongside the site spec and the `visual-design` skill. The reference is one of several reinforcing inputs, not the sole driver.

## Scope the reference to the request

- **Creating a new site:** the reference informs the whole design direction — palette, type, section rhythm, and the below-the-fold composition (use the reference's section rhythm to break out of a default vertical stack).
- **Editing an existing site:** apply the reference **only to the section the user is adding or restyling right now**. Do not restyle the rest of the theme to match a one-off reference — the site's existing visual identity stays whatever the current files already establish. A URL mentioned only on an earlier turn does not carry into later edits.

## Safety

The fetch tools only reach public http(s) URLs; localhost, private/reserved IP addresses, and non-HTML responses are refused. If a fetch fails, say so briefly and continue with whatever you did get (or with the user's described intent) rather than blocking the build.
