---
name: plugin-recommendations
description: Choose WordPress plugins and plugin-provided blocks for features that core WordPress blocks do not cover, while keeping generated content editable and avoiding raw HTML fallbacks.
user-invokable: true
---

# Plugin Recommendations

Use this skill when the user asks for a feature that core WordPress blocks do not cleanly provide, such as forms, slideshows, related content, business hours, shops/stores/ecommerce, events, LMS/course features, or third-party embeds.

## Decision Rules

- Prefer core WordPress blocks when they satisfy the request.
- Prefer installed and active plugins before installing new ones.
- Prefer plugin-provided blocks over raw `core/html` for user-editable features.
- Install a plugin only when the feature needs backend behavior, registered blocks, or maintained integrations.
- Do not stack overlapping plugins for the same concern unless the user explicitly asks.
- Keep `core/html` as a last resort for the `block-content` skill's allowed cases: inline SVG, interaction markup with no block equivalent, or a single bottom-of-page script block.

## Discovery Workflow

1. List active plugins:

```text
wp_cli plugin list --status=active --format=json
```

2. If considering a plugin, check whether it is already installed or active.
3. Discover registered blocks:

```text
wp_cli eval 'foreach (\WP_Block_Type_Registry::get_instance()->get_all_registered() as $n => $b) echo $n . PHP_EOL;'
```

4. If you expect a plugin block but it is missing, check whether the plugin uses modules or feature flags, then activate the relevant module.
5. Use the registered block in editable block markup.
6. Validate generated block markup with `validate_html_blocks`, then `validate_and_fix_blocks` with `filePath` when the content lives in a file so safe editor fixes are applied automatically.

## WooCommerce Shop Sites

A request for a "shop" or "store" is an ecommerce request by default unless the user explicitly specifies otherwise. Always set up WooCommerce with products whenever the request names a shop, store, or ecommerce site, OR the planned design includes products, product categories or ranges, prices, a catalog, a "Shop" page, or add-to-cart - even if the user does not name WooCommerce and does not explicitly ask for products. A shop with an empty catalog is not useful. Size and scope qualifiers like "small", "simple", or "just a few pages" describe how big the site is, not whether it sells - a small shop is still a shop and still gets WooCommerce.

1. Install and activate WooCommerce:

```text
wp_cli plugin install woocommerce --activate
```

2. Activation automatically creates the Shop, Cart, Checkout, and My Account pages. Suppress the setup-wizard redirect so the storefront is usable right away:

```text
wp_cli option delete _transient__wc_activation_redirect
```

3. Configure store basics. Match the currency and base location to the user's context when known, otherwise use sensible defaults. Also turn off "Coming soon" mode, which fresh WooCommerce installs enable by default:

```text
wp_cli option update woocommerce_coming_soon no
wp_cli option update woocommerce_currency USD
wp_cli option update woocommerce_default_country "US:CA"
```

4. Add products that match what the shop actually sells. Create real, contextual products - coffee products for a coffee shop, books for a bookstore, plants for a plant store - rather than generic placeholders. Only fall back to generic sample products when the shop's niche is genuinely unknown.

Products should ideally have a real, relevant image, and a storefront with product images looks far more complete than one with placeholder thumbnails. **Do not pass remote image URLs via `--images` with `src`.** WooCommerce derives the upload filename from the URL's basename, and the extension-less CDN URLs most image hosts return (e.g. `https://images.unsplash.com/photo-1589924691995-400dc9ecc119?w=600`) are rejected with `Invalid image: Sorry, you are not allowed to upload this file type`. Instead, download each image to the site with a real extension, import it into the media library, then reference the resulting attachment ID. The WooCommerce CLI requires a `--user`:

```text
# Download the image to the site's uploads with a real .jpg/.png/.webp name (use the Bash tool with the site path from site_info):
#   curl -L "<image-url>" -o "<site-path>/wp-content/uploads/premium-dog-food.jpg"
wp_cli media import wp-content/uploads/premium-dog-food.jpg --porcelain
wp_cli wc product create --name="Premium Dog Food" --type=simple --regular_price=42 --status=publish --description="High-protein, grain-free kibble made with real chicken." --images='[{"id":<attachmentId>}]' --categories='[{"id":N}]' --user=admin
```

Create several products (aim for 4-8) so the shop and catalog pages look populated. Group related products with a category by passing its term ID via `--categories='[{"id":N}]'` after creating the category:

```text
wp_cli wc product_cat create --name="Single Origin" --user=admin
```

5. Discover the registered WooCommerce blocks so storefront and landing pages use editable plugin blocks rather than raw HTML:

```text
wp_cli eval 'foreach (\WP_Block_Type_Registry::get_instance()->get_all_registered() as $n => $b) if (strpos($n, "woocommerce/") === 0 && (!isset($b->supports["inserter"]) || $b->supports["inserter"] !== false)) echo $n . PHP_EOL;'
```

Use blocks such as `woocommerce/product-collection`, `woocommerce/featured-product`, and `woocommerce/all-products` to surface the catalog.

6. After installing WooCommerce, go back and edit the header template part (`parts/header.html`) to add a mini-cart, unless it already shows one. Add the `woocommerce/mini-cart` block alongside the navigation - it renders a cart icon with a live item count and opens the cart drawer - and add a "Shop" link to the primary navigation.

## Jetpack Forms

When the user asks for a contact form, feedback form, survey, or any other interactive form that collects submissions, use Jetpack Forms - not raw HTML `<form>` elements.

Install the plugin and activate the `contact-form` Jetpack module first if not already active. Both steps are required, otherwise the form blocks render as empty `<div>` elements on the frontend:

```text
wp_cli plugin install jetpack --activate
wp_cli jetpack module activate contact-form
```

Then build the form with blocks. Each field is a container block that holds a `jetpack/label` and a `jetpack/input` child. The submit button is a standard `core/button` (written as `wp:button` in block markup) placed directly inside the form container.

```html
<!-- wp:jetpack/contact-form {"jetpackCRM":false,"variationName":"default","lock":{"remove":true,"move":true},"layout":{"type":"flex","flexWrap":"nowrap","orientation":"vertical","justifyContent":"left","verticalAlignment":"top"}} -->
<div class="wp-block-jetpack-contact-form"><!-- wp:jetpack/field-name {"required":true,"fieldVariant":"name"} -->
<div><!-- wp:jetpack/label {"label":"Name"} /-->

<!-- wp:jetpack/input /--></div>
<!-- /wp:jetpack/field-name -->

<!-- wp:jetpack/field-email {"required":true} -->
<div><!-- wp:jetpack/label {"label":"Email"} /-->

<!-- wp:jetpack/input /--></div>
<!-- /wp:jetpack/field-email -->

<!-- wp:jetpack/field-textarea -->
<div><!-- wp:jetpack/label {"label":"Message"} /-->

<!-- wp:jetpack/input {"type":"textarea"} /--></div>
<!-- /wp:jetpack/field-textarea -->

<!-- wp:button {"tagName":"button","type":"submit","lock":{"move":false,"remove":true}} -->
<div class="wp-block-button"><button type="submit" class="wp-block-button__link wp-element-button">Contact us</button></div>
<!-- /wp:button --></div>
<!-- /wp:jetpack/contact-form -->
```

Available field block types: `jetpack/field-name`, `jetpack/field-text`, `jetpack/field-email`, `jetpack/field-url`, `jetpack/field-telephone`, `jetpack/field-textarea`, `jetpack/field-checkbox`, `jetpack/field-checkbox-multiple`, `jetpack/field-radio`, `jetpack/field-select`.

Each field block is a container with two inner blocks: `jetpack/label` (accepts a `label` string attribute) and `jetpack/input` (accepts a `type` attribute, defaults to text; use `textarea` for `jetpack/field-textarea`). Top-level field attributes include `required` (boolean) and `fieldVariant` (string, for example `name` for `jetpack/field-name`).

The container `jetpack/contact-form` supports `subject` (email subject line) and `to` (recipient address or comma-separated list).

## Jetpack For Non-Core Needs

When the user wants a feature that no core block cleanly provides - slideshows, related-posts grids, business hours, Mailchimp signups, and similar features - prefer a Jetpack block over a raw-HTML `core/html` block.

The specific Jetpack Forms rule above takes precedence. This rule only applies when it does not cover the request.

When it applies:

1. Make sure Jetpack is active:

```text
wp_cli plugin install jetpack --activate
```

2. Discover candidate Jetpack blocks by listing what Jetpack has registered:

```text
wp_cli eval 'foreach (\WP_Block_Type_Registry::get_instance()->get_all_registered() as $n => $b) if (strpos($n, "jetpack/") === 0 && (!isset($b->supports["inserter"]) || $b->supports["inserter"] !== false)) echo $n . PHP_EOL;'
```

If the block you expect is not listed, the relevant Jetpack module is probably inactive. Run:

```text
wp_cli jetpack module list
```

Then activate the needed module:

```text
wp_cli jetpack module activate <slug>
```

3. Use the registered block in page markup and validate with `validate_html_blocks`, then `validate_and_fix_blocks` with `filePath` when possible.
