<?php
/**
 * Title: Gallery — image grid
 * Slug: <theme-slug>/gallery-grid
 * Categories: gallery
 * Block Types: core/gallery
 * Description: wp:gallery with N images. Use for portfolio or photo grids.
 *
 * The agent fills wp:image children based on the source's image count. wp:gallery handles
 * responsive grid + lightbox. Slots: {{HEADLINE}}, {{ITEM_N_IMAGE}}, {{ITEM_N_ALT}}.
 */
?>
<!-- wp:group {"align":"full","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--60)","bottom":"var(--wp--preset--spacing--60)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}}} -->
<div class="wp-block-group alignfull" style="padding-top:var(--wp--preset--spacing--60);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--60);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:heading {"textAlign":"center","fontFamily":"display"} -->
<h2 class="wp-block-heading has-text-align-center has-display-font-family">{{HEADLINE}}</h2>
<!-- /wp:heading -->

<!-- wp:gallery {"columns":3,"linkTo":"none","align":"wide","sizeSlug":"large"} -->
<figure class="wp-block-gallery alignwide has-nested-images columns-3 is-cropped">
<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->
<figure class="wp-block-image size-large"><img src="{{ITEM_1_IMAGE}}" alt="{{ITEM_1_ALT}}"/></figure>
<!-- /wp:image -->

<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->
<figure class="wp-block-image size-large"><img src="{{ITEM_2_IMAGE}}" alt="{{ITEM_2_ALT}}"/></figure>
<!-- /wp:image -->

<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->
<figure class="wp-block-image size-large"><img src="{{ITEM_3_IMAGE}}" alt="{{ITEM_3_ALT}}"/></figure>
<!-- /wp:image -->

<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->
<figure class="wp-block-image size-large"><img src="{{ITEM_4_IMAGE}}" alt="{{ITEM_4_ALT}}"/></figure>
<!-- /wp:image -->

<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->
<figure class="wp-block-image size-large"><img src="{{ITEM_5_IMAGE}}" alt="{{ITEM_5_ALT}}"/></figure>
<!-- /wp:image -->

<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->
<figure class="wp-block-image size-large"><img src="{{ITEM_6_IMAGE}}" alt="{{ITEM_6_ALT}}"/></figure>
<!-- /wp:image -->
</figure>
<!-- /wp:gallery -->
</div>
<!-- /wp:group -->
