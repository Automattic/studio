<?php
/**
 * Title: Team — 3-column member cards
 * Slug: <theme-slug>/team-grid-3
 * Categories: columns
 * Block Types: core/columns
 * Description: Three team-member cards: image + name + role + optional links.
 *
 * Repeats: 3 columns. Slots: {{HEADLINE}}, {{ITEM_N_IMAGE}}, {{ITEM_N_ALT}}, {{ITEM_N_HEADING}} (name), {{ITEM_N_BODY}} (role).
 */
?>
<!-- wp:group {"align":"full","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--80)","bottom":"var(--wp--preset--spacing--80)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}}} -->
<div class="wp-block-group alignfull" style="padding-top:var(--wp--preset--spacing--80);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--80);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:heading {"textAlign":"center","fontFamily":"display"} -->
<h2 class="wp-block-heading has-text-align-center has-display-font-family">{{HEADLINE}}</h2>
<!-- /wp:heading -->

<!-- wp:columns {"align":"wide"} -->
<div class="wp-block-columns alignwide">
<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:image {"sizeSlug":"medium","style":{"border":{"radius":"50%"}}} -->
<figure class="wp-block-image size-medium has-custom-border"><img src="{{ITEM_1_IMAGE}}" alt="{{ITEM_1_ALT}}" style="border-radius:50%"/></figure>
<!-- /wp:image -->

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
<!-- wp:image {"sizeSlug":"medium","style":{"border":{"radius":"50%"}}} -->
<figure class="wp-block-image size-medium has-custom-border"><img src="{{ITEM_2_IMAGE}}" alt="{{ITEM_2_ALT}}" style="border-radius:50%"/></figure>
<!-- /wp:image -->

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
<!-- wp:image {"sizeSlug":"medium","style":{"border":{"radius":"50%"}}} -->
<figure class="wp-block-image size-medium has-custom-border"><img src="{{ITEM_3_IMAGE}}" alt="{{ITEM_3_ALT}}" style="border-radius:50%"/></figure>
<!-- /wp:image -->

<!-- wp:heading {"level":3,"textAlign":"center"} -->
<h3 class="wp-block-heading has-text-align-center">{{ITEM_3_HEADING}}</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","textColor":"text-muted"} -->
<p class="has-text-align-center has-text-muted-color has-text-color">{{ITEM_3_BODY}}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:column -->
</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->
