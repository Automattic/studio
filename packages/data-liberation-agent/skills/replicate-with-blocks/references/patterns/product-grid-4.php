<?php
/**
 * Title: Products — 4-column grid
 * Slug: <theme-slug>/product-grid-4
 * Categories: columns, woocommerce
 * Block Types: core/columns
 * Description: Four-column product card grid (image + title + price + buy button). Use core blocks
 * (NOT WooCommerce blocks) so the pattern works whether or not Woo is installed; the agent fills
 * product fields from products.jsonl or the source HTML.
 *
 * Repeats: 4 columns shown. Slots: {{HEADLINE}}, {{ITEM_N_IMAGE}}, {{ITEM_N_ALT}}, {{ITEM_N_HEADING}}
 * (product name), {{ITEM_N_BODY}} (price string), {{ITEM_N_LINK}}.
 */
?>
<!-- wp:group {"align":"full","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--60)","bottom":"var(--wp--preset--spacing--60)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}}} -->
<div class="wp-block-group alignfull" style="padding-top:var(--wp--preset--spacing--60);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--60);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:heading {"textAlign":"center","fontFamily":"display"} -->
<h2 class="wp-block-heading has-text-align-center has-display-font-family">{{HEADLINE}}</h2>
<!-- /wp:heading -->

<!-- wp:columns {"align":"wide"} -->
<div class="wp-block-columns alignwide">
<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:image {"sizeSlug":"large","style":{"border":{"radius":"8px"}}} -->
<figure class="wp-block-image size-large has-custom-border"><a href="{{ITEM_1_LINK}}"><img src="{{ITEM_1_IMAGE}}" alt="{{ITEM_1_ALT}}" style="border-radius:8px"/></a></figure>
<!-- /wp:image -->
<!-- wp:heading {"level":4} --><h4 class="wp-block-heading"><a href="{{ITEM_1_LINK}}">{{ITEM_1_HEADING}}</a></h4><!-- /wp:heading -->
<!-- wp:paragraph {"textColor":"accent-primary","style":{"typography":{"fontWeight":"600"}}} --><p class="has-accent-primary-color has-text-color" style="font-weight:600">{{ITEM_1_BODY}}</p><!-- /wp:paragraph -->
</div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:image {"sizeSlug":"large","style":{"border":{"radius":"8px"}}} -->
<figure class="wp-block-image size-large has-custom-border"><a href="{{ITEM_2_LINK}}"><img src="{{ITEM_2_IMAGE}}" alt="{{ITEM_2_ALT}}" style="border-radius:8px"/></a></figure>
<!-- /wp:image -->
<!-- wp:heading {"level":4} --><h4 class="wp-block-heading"><a href="{{ITEM_2_LINK}}">{{ITEM_2_HEADING}}</a></h4><!-- /wp:heading -->
<!-- wp:paragraph {"textColor":"accent-primary","style":{"typography":{"fontWeight":"600"}}} --><p class="has-accent-primary-color has-text-color" style="font-weight:600">{{ITEM_2_BODY}}</p><!-- /wp:paragraph -->
</div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:image {"sizeSlug":"large","style":{"border":{"radius":"8px"}}} -->
<figure class="wp-block-image size-large has-custom-border"><a href="{{ITEM_3_LINK}}"><img src="{{ITEM_3_IMAGE}}" alt="{{ITEM_3_ALT}}" style="border-radius:8px"/></a></figure>
<!-- /wp:image -->
<!-- wp:heading {"level":4} --><h4 class="wp-block-heading"><a href="{{ITEM_3_LINK}}">{{ITEM_3_HEADING}}</a></h4><!-- /wp:heading -->
<!-- wp:paragraph {"textColor":"accent-primary","style":{"typography":{"fontWeight":"600"}}} --><p class="has-accent-primary-color has-text-color" style="font-weight:600">{{ITEM_3_BODY}}</p><!-- /wp:paragraph -->
</div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:image {"sizeSlug":"large","style":{"border":{"radius":"8px"}}} -->
<figure class="wp-block-image size-large has-custom-border"><a href="{{ITEM_4_LINK}}"><img src="{{ITEM_4_IMAGE}}" alt="{{ITEM_4_ALT}}" style="border-radius:8px"/></a></figure>
<!-- /wp:image -->
<!-- wp:heading {"level":4} --><h4 class="wp-block-heading"><a href="{{ITEM_4_LINK}}">{{ITEM_4_HEADING}}</a></h4><!-- /wp:heading -->
<!-- wp:paragraph {"textColor":"accent-primary","style":{"typography":{"fontWeight":"600"}}} --><p class="has-accent-primary-color has-text-color" style="font-weight:600">{{ITEM_4_BODY}}</p><!-- /wp:paragraph -->
</div>
<!-- /wp:column -->
</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->
