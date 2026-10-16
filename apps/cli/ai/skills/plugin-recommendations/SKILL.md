---
name: plugin-recommendations
description: Choose recommended plugins and plugin-provided blocks for features core WordPress blocks do not cover - ecommerce (WooCommerce), forms and newsletters (Jetpack), online courses and quizzes (Sensei LMS), polls, surveys and ratings (Crowdsignal), spam protection (Akismet) - while keeping generated content editable and avoiding raw HTML fallbacks. Any request to sell products or build a shop, store, or storefront requires WooCommerce with products.
---

# Plugin Recommendations

For a feature core blocks do not cleanly provide, use the recommended plugin's own blocks — never a hand-built `core/html`, a plain `<form>`, or core blocks driven by custom CSS/JS.

| The site needs… | Plugin | Install slug |
| --- | --- | --- |
| To sell products — shop, store, storefront, catalog, prices | WooCommerce | `woocommerce` |
| Contact, feedback, or multi-field forms | Jetpack Forms | `jetpack`, `contact-form` module |
| Email newsletter, subscribe form | Jetpack Newsletter | `jetpack`, `subscriptions` module |
| Slideshow, carousel, tiled gallery, related posts, business hours, other non-core features | Jetpack blocks (`jetpack/slideshow`, `jetpack/tiled-gallery`, …) | `jetpack` |
| Social auto-sharing, stats, search, SEO meta | Jetpack modules | `jetpack` |
| Online courses, lessons, quizzes | Sensei LMS | `sensei-lms` |
| Polls, surveys, ratings, NPS, applause | Crowdsignal | `crowdsignal-forms` |
| Comment and form spam protection | Akismet | bundled — recommend activating after deploy, not locally |

Prefer core blocks when they suffice, active plugins before new ones, and these plugins before third-party ones.

## Using a plugin's blocks

After installing, read the blocks from the plugin itself: `wp_cli eval 'foreach (WP_Block_Type_Registry::get_instance()->get_all_registered() as $n => $b) echo $n . PHP_EOL;'` lists what is registered, and the plugin's `block.json` files under `wp-content/plugins/<plugin>/` give each block's attributes and allowed children. A Jetpack block that is missing usually means its module is inactive (`wp_cli jetpack module list`, then `module activate <slug>`).

## What the source will not tell you

- **Selling means WooCommerce with real products**, whatever the size or framing of the request. Install it and create 4–8 products that fit the shop, in categories, before design work. `wc` commands need `--user=admin`. Give products images by attachment ID (`--images='[{"id":N}]'`) from `generate_images` or `media import`; remote image URLs are rejected. After activation, delete `_transient__wc_activation_redirect`, set `woocommerce_coming_soon` to `no`, add a `woocommerce/mini-cart` and a Shop link to the header, and keep WooCommerce's default templates unless the design needs a different structure.
- **Jetpack Newsletter** cannot be activated on a local site (it needs WordPress.com): install Jetpack and recommend it, without building a substitute form.
- **Crowdsignal** blocks need a Crowdsignal.com connection to record responses; mention it when the user expects live results.
- **Sensei LMS** creates its pages on activation; paid courses also need WooCommerce.
