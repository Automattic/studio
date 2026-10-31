---
name: plugin-recommendations
description: Plugins whose blocks cover features core WordPress blocks do not - ecommerce (WooCommerce), forms, newsletters and slideshows (Jetpack), online courses and quizzes (Sensei LMS), polls, surveys and ratings (Crowdsignal), spam protection (Akismet) - and how to set each up so its content stays editable in the editor.
---

# Plugin Recommendations

A plugin's own blocks keep a feature editable in the editor and working as the plugin updates. These plugins cover features core blocks leave out:

| The site needs… | Plugin | Install slug |
| --- | --- | --- |
| To sell products — shop, store, storefront, catalog, prices | WooCommerce | `woocommerce` |
| Contact, feedback, or multi-field forms | Jetpack Forms | `jetpack`, `contact-form` module |
| Email newsletter, subscribe form | Jetpack Newsletter once the site is connected to WordPress.com; until then, a Jetpack Forms email form | `jetpack`, `subscriptions` module, which needs a connection; until then `contact-form` module |
| Slideshow, carousel, tiled gallery, related posts, business hours, other non-core features | Jetpack blocks (`jetpack/slideshow`, `jetpack/tiled-gallery`, …) | `jetpack`, `blocks` module |
| Social auto-sharing, stats, search, SEO meta | Jetpack modules | `jetpack` |
| Online courses, lessons, quizzes | Sensei LMS | `sensei-lms` |
| Polls, surveys, ratings, NPS, applause | Crowdsignal | `crowdsignal-forms` |
| Comment and form spam protection | Akismet | bundled — recommend activating after deploy, not locally |

The site's active plugins are part of its stack: their blocks are already there. Whether to add a plugin, and which, is the user's choice of stack.

## Using a plugin's blocks

Jetpack loads its blocks on a site that is connected to WordPress.com or in offline mode, as a local site is, while its `blocks` module is active (`Jetpack_Gutenberg::should_load` in `class.jetpack-gutenberg.php`); a feature's blocks also need its module, as forms need `contact-form`. Jetpack activates its default modules when the site connects; on a site that is not connected, Studio activates the default ones that need no connection, Forms and Blocks among them. The Active site section states the active modules, and `wp jetpack module activate <slug>` turns one on.

## What the source will not tell you

- **A WooCommerce shop shows real products.** Create 4–8 products that fit the shop, in categories, before design work. `wc` commands need `--user=admin`. Give products images by attachment ID (`--images='[{"id":N}]'`) from `generate_images` or `media import`; remote image URLs are rejected. After activation, delete `_transient__wc_activation_redirect`, add a `woocommerce/mini-cart` and a Shop link to the header, and keep WooCommerce's default templates unless the design needs a different structure.
- **Jetpack Newsletter** needs a WordPress.com connection (its `subscriptions` module header says Requires Connection: Yes), which a local site does not have: the module does not activate and its subscribe block is not registered, so WordPress prints its saved HTML, a form nothing on the site handles. On a local site, a Jetpack Forms form (`jetpack/contact-form` with a `jetpack/field-email` field) collects signups, each saved as a Form Responses post; mention that the Newsletter's subscribe block can take over once the site is connected.
- **Crowdsignal** blocks need a Crowdsignal.com connection to record responses; mention it when the user expects live results.
- **Sensei LMS** creates its pages on activation; paid courses also need WooCommerce.
