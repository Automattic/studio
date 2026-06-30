<?php
/**
 * Title: Product — featured single
 * Slug: <theme-slug>/product-card-single
 * Categories: woocommerce
 * Block Types: core/columns
 * Description: Featured-product card: large image + name + price + CTA. Use on product detail pages
 * or as a homepage hero-product callout.
 *
 * Slots: {{HEADLINE}} (product name), {{BODY}} (description), {{PRICE}}, {{CTA_LABEL}}, {{CTA_HREF}},
 * {{IMAGE_URL}}, {{IMAGE_ALT}}.
 */
?>
<!-- wp:group {"align":"full","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--80)","bottom":"var(--wp--preset--spacing--80)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}}} -->
<div class="wp-block-group alignfull" style="padding-top:var(--wp--preset--spacing--80);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--80);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:columns {"align":"wide","verticalAlignment":"center"} -->
<div class="wp-block-columns alignwide are-vertically-aligned-center">
<!-- wp:column {"verticalAlignment":"center","width":"55%"} -->
<div class="wp-block-column is-vertically-aligned-center" style="flex-basis:55%">
<!-- wp:image {"sizeSlug":"large"} -->
<figure class="wp-block-image size-large"><img src="{{IMAGE_URL}}" alt="{{IMAGE_ALT}}"/></figure>
<!-- /wp:image -->
</div>
<!-- /wp:column -->

<!-- wp:column {"verticalAlignment":"center","width":"45%"} -->
<div class="wp-block-column is-vertically-aligned-center" style="flex-basis:45%">
<!-- wp:heading {"level":1,"fontFamily":"display"} -->
<h1 class="wp-block-heading has-display-font-family">{{HEADLINE}}</h1>
<!-- /wp:heading -->

<!-- wp:heading {"level":2,"textColor":"accent-primary","fontFamily":"display"} -->
<h2 class="wp-block-heading has-accent-primary-color has-text-color has-display-font-family">{{PRICE}}</h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"textColor":"text-muted","style":{"typography":{"lineHeight":"1.7"}}} -->
<p class="has-text-muted-color has-text-color" style="line-height:1.7">{{BODY}}</p>
<!-- /wp:paragraph -->

<!-- wp:buttons -->
<div class="wp-block-buttons">
<!-- wp:button {"backgroundColor":"accent-primary","textColor":"text-inverse"} -->
<div class="wp-block-button"><a class="wp-block-button__link has-text-inverse-color has-accent-primary-background-color has-text-color has-background wp-element-button" href="{{CTA_HREF}}">{{CTA_LABEL}}</a></div>
<!-- /wp:button -->
</div>
<!-- /wp:buttons -->
</div>
<!-- /wp:column -->
</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->
