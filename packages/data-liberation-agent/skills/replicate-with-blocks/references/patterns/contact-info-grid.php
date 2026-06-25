<?php
/**
 * Title: Contact — info grid
 * Slug: <theme-slug>/contact-info-grid
 * Categories: text, columns
 * Block Types: core/columns
 * Description: Address, phone, email, hours in a 2x2 or 4-column grid. No real form (post_content can't render forms).
 *
 * Slots: {{HEADLINE}}, {{ITEM_N_HEADING}} (e.g. "Address"), {{ITEM_N_BODY}} (the actual address text).
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
<!-- wp:heading {"level":3,"textAlign":"center"} -->
<h3 class="wp-block-heading has-text-align-center">{{ITEM_1_HEADING}}</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","textColor":"text-muted"} -->
<p class="has-text-align-center has-text-muted-color has-text-color">{{ITEM_1_BODY}}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:heading {"level":3,"textAlign":"center"} -->
<h3 class="wp-block-heading has-text-align-center">{{ITEM_2_HEADING}}</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","textColor":"text-muted"} -->
<p class="has-text-align-center has-text-muted-color has-text-color">{{ITEM_2_BODY}}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:heading {"level":3,"textAlign":"center"} -->
<h3 class="wp-block-heading has-text-align-center">{{ITEM_3_HEADING}}</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","textColor":"text-muted"} -->
<p class="has-text-align-center has-text-muted-color has-text-color">{{ITEM_3_BODY}}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:heading {"level":3,"textAlign":"center"} -->
<h3 class="wp-block-heading has-text-align-center">{{ITEM_4_HEADING}}</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","textColor":"text-muted"} -->
<p class="has-text-align-center has-text-muted-color has-text-color">{{ITEM_4_BODY}}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:column -->
</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->
