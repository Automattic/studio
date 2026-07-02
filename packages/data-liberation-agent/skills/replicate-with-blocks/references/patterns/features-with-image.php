<?php
/**
 * Title: Features — alternating image-text rows
 * Slug: <theme-slug>/features-with-image
 * Categories: columns
 * Block Types: core/columns
 * Description: Alternating media-text rows — image left, then image right, etc. Use for narrative product feature explanations.
 *
 * Repeats: 2 rows shown; duplicate and flip the column order for additional rows. Use {"verticalAlignment":"center"} on outer columns to keep image+text aligned.
 * Slots: {{ITEM_N_HEADING}}, {{ITEM_N_BODY}}, {{ITEM_N_IMAGE}}, {{ITEM_N_ALT}}.
 */
?>
<!-- wp:group {"align":"full","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--60)","bottom":"var(--wp--preset--spacing--60)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"},"blockGap":"var(--wp--preset--spacing--60)"}}} -->
<div class="wp-block-group alignfull" style="padding-top:var(--wp--preset--spacing--60);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--60);padding-left:var(--wp--preset--spacing--40)">

<!-- wp:columns {"align":"wide","verticalAlignment":"center"} -->
<div class="wp-block-columns alignwide are-vertically-aligned-center">
<!-- wp:column {"verticalAlignment":"center"} -->
<div class="wp-block-column is-vertically-aligned-center">
<!-- wp:image {"sizeSlug":"large"} -->
<figure class="wp-block-image size-large"><img src="{{ITEM_1_IMAGE}}" alt="{{ITEM_1_ALT}}"/></figure>
<!-- /wp:image -->
</div>
<!-- /wp:column -->

<!-- wp:column {"verticalAlignment":"center"} -->
<div class="wp-block-column is-vertically-aligned-center">
<!-- wp:heading {"level":2,"fontFamily":"display"} -->
<h2 class="wp-block-heading has-display-font-family">{{ITEM_1_HEADING}}</h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"textColor":"text-muted"} -->
<p class="has-text-muted-color has-text-color">{{ITEM_1_BODY}}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:column -->
</div>
<!-- /wp:columns -->

<!-- wp:columns {"align":"wide","verticalAlignment":"center"} -->
<div class="wp-block-columns alignwide are-vertically-aligned-center">
<!-- wp:column {"verticalAlignment":"center"} -->
<div class="wp-block-column is-vertically-aligned-center">
<!-- wp:heading {"level":2,"fontFamily":"display"} -->
<h2 class="wp-block-heading has-display-font-family">{{ITEM_2_HEADING}}</h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"textColor":"text-muted"} -->
<p class="has-text-muted-color has-text-color">{{ITEM_2_BODY}}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:column -->

<!-- wp:column {"verticalAlignment":"center"} -->
<div class="wp-block-column is-vertically-aligned-center">
<!-- wp:image {"sizeSlug":"large"} -->
<figure class="wp-block-image size-large"><img src="{{ITEM_2_IMAGE}}" alt="{{ITEM_2_ALT}}"/></figure>
<!-- /wp:image -->
</div>
<!-- /wp:column -->
</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->
