<?php
/**
 * Title: Features — 3-column grid
 * Slug: <theme-slug>/features-grid-3
 * Categories: columns
 * Block Types: core/columns
 * Description: Three columns of icon/heading/body. Workhorse "why us" section.
 *
 * Repeats: 3 columns. Slots scoped per item: {{ITEM_N_HEADING}}, {{ITEM_N_BODY}}, optionally {{ITEM_N_IMAGE}}.
 * If the source has fewer than 3 items, drop the extra <wp:column> blocks; if more, copy a column and bump N.
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
<!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading">{{ITEM_2_HEADING}}</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"textColor":"text-muted"} -->
<p class="has-text-muted-color has-text-color">{{ITEM_2_BODY}}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading">{{ITEM_3_HEADING}}</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"textColor":"text-muted"} -->
<p class="has-text-muted-color has-text-color">{{ITEM_3_BODY}}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:column -->
</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->
