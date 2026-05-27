---
name: plugin-recommendations
description: Choose WordPress plugins and plugin-provided blocks for features that core WordPress blocks do not cover, while keeping generated content editable and avoiding raw HTML fallbacks.
user-invokable: true
---

# Plugin Recommendations

Use this skill when the user asks for a feature that core WordPress blocks do not cleanly provide, such as forms, slideshows, related content, business hours, ecommerce, events, LMS/course features, or third-party embeds.

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
