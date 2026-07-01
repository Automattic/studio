<?php
/**
 * Title: Features — 2-column wide grid
 * Slug: <theme-slug>/features-grid-2
 * Categories: columns
 * Block Types: core/columns
 * Description: Two columns with optional images. Use for 4 features arranged 2x2 (duplicate the columns block).
 *
 * Repeats: 2 columns; duplicate the wp:columns block to make a 2x2.
 * Slots: {{ITEM_N_HEADING}}, {{ITEM_N_BODY}}, {{ITEM_N_IMAGE}}, {{ITEM_N_ALT}}.
 */
?>
<!-- wp:group {"align":"full","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--60)","bottom":"var(--wp--preset--spacing--60)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}}} -->
<div class="wp-block-group alignfull" style="padding-top:var(--wp--preset--spacing--60);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--60);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:columns {"align":"wide"} -->
<div class="wp-block-columns alignwide">
<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:image {"sizeSlug":"large"} -->
<figure class="wp-block-image size-large"><img src="{{ITEM_1_IMAGE}}" alt="{{ITEM_1_ALT}}"/></figure>
<!-- /wp:image -->

<!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading">{{ITEM_1_HEADING}}</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"textColor":"text-muted"} -->
<p class="has-text-muted-color has-text-color">{{ITEM_1_BODY}}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:image {"sizeSlug":"large"} -->
<figure class="wp-block-image size-large"><img src="{{ITEM_2_IMAGE}}" alt="{{ITEM_2_ALT}}"/></figure>
<!-- /wp:image -->

<!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading">{{ITEM_2_HEADING}}</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"textColor":"text-muted"} -->
<p class="has-text-muted-color has-text-color">{{ITEM_2_BODY}}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:column -->
</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->
