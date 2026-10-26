---
name: plugin-recommendations
description: Choose recommended plugins and plugin-provided blocks for features core WordPress blocks do not cover - ecommerce (WooCommerce), forms and newsletters (Jetpack), online courses and quizzes (Sensei LMS), polls, surveys and ratings (Crowdsignal), spam protection (Akismet) - with content that stays editable in the editor. Any request to sell products or build a shop, store, or storefront requires WooCommerce with products.
---

# Plugin Recommendations

For a feature core blocks leave out, use the recommended plugin's own blocks, which the editor edits and the plugin keeps working.

| The site needs… | Plugin | Install slug |
| --- | --- | --- |
| To sell products — shop, store, storefront, catalog, prices | WooCommerce | `woocommerce` |
| Contact, feedback, or multi-field forms | Jetpack Forms | `jetpack`, `contact-form` module |
| Email newsletter, subscribe form | Jetpack Newsletter | `jetpack`, `subscriptions` module |
| Slideshow, carousel, tiled gallery, related posts, business hours, other non-core features | Jetpack blocks (`jetpack/slideshow`, `jetpack/tiled-gallery`, …) | `jetpack`, `blocks` module |
| Social auto-sharing, stats, search, SEO meta | Jetpack modules | `jetpack` |
| Online courses, lessons, quizzes | Sensei LMS | `sensei-lms` |
| Polls, surveys, ratings, NPS, applause | Crowdsignal | `crowdsignal-forms` |
| Comment and form spam protection | Akismet | bundled — recommend activating after deploy, not locally |

Prefer core blocks when they suffice, active plugins before new ones, and these plugins before third-party ones.

## Using a plugin's blocks

Jetpack registers its blocks only while its `blocks` module is active (`Jetpack_Gutenberg::should_load` in `class.jetpack-gutenberg.php`), which a site that has never connected to WordPress.com starts without, and a block can also need its feature's module, as forms need `contact-form`. `wp jetpack module list` shows which are active, and `wp jetpack module activate <slug>` turns one on.

## What the source will not tell you

- **Selling means WooCommerce with real products**, whatever the size or framing of the request. Install it and create 4–8 products that fit the shop, in categories, before design work. `wc` commands need `--user=admin`. Give products images by attachment ID (`--images='[{"id":N}]'`) from `generate_images` or `media import`; remote image URLs are rejected. After activation, delete `_transient__wc_activation_redirect`, add a `woocommerce/mini-cart` and a Shop link to the header, and keep WooCommerce's default templates unless the design needs a different structure.
- **Jetpack Newsletter** cannot be activated on a local site (it needs WordPress.com): install Jetpack and recommend it: its subscribe block works once the site is connected to WordPress.com.
- **Crowdsignal** blocks need a Crowdsignal.com connection to record responses; mention it when the user expects live results.
- **Sensei LMS** creates its pages on activation; paid courses also need WooCommerce.
