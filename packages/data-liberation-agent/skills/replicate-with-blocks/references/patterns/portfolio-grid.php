<?php
/**
 * Title: Portfolio — project cards
 * Slug: <theme-slug>/portfolio-grid
 * Categories: columns
 * Block Types: core/columns
 * Description: Project cards (image + title + tags) in a multi-column layout.
 *
 * Repeats: 3 columns shown — duplicate inner column blocks for more.
 * Slots: {{HEADLINE}}, {{ITEM_N_IMAGE}}, {{ITEM_N_ALT}}, {{ITEM_N_HEADING}} (project name), {{ITEM_N_BODY}} (tags or description), {{ITEM_N_LINK}}.
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
<!-- wp:image {"sizeSlug":"large","style":{"border":{"radius":"8px"}}} -->
<figure class="wp-block-image size-large has-custom-border"><a href="{{ITEM_1_LINK}}"><img src="{{ITEM_1_IMAGE}}" alt="{{ITEM_1_ALT}}" style="border-radius:8px"/></a></figure>
<!-- /wp:image -->

<!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading"><a href="{{ITEM_1_LINK}}">{{ITEM_1_HEADING}}</a></h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"textColor":"text-muted","style":{"typography":{"fontSize":"0.875rem"}}} -->
<p class="has-text-muted-color has-text-color" style="font-size:0.875rem">{{ITEM_1_BODY}}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:image {"sizeSlug":"large","style":{"border":{"radius":"8px"}}} -->
<figure class="wp-block-image size-large has-custom-border"><a href="{{ITEM_2_LINK}}"><img src="{{ITEM_2_IMAGE}}" alt="{{ITEM_2_ALT}}" style="border-radius:8px"/></a></figure>
<!-- /wp:image -->

<!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading"><a href="{{ITEM_2_LINK}}">{{ITEM_2_HEADING}}</a></h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"textColor":"text-muted","style":{"typography":{"fontSize":"0.875rem"}}} -->
<p class="has-text-muted-color has-text-color" style="font-size:0.875rem">{{ITEM_2_BODY}}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:image {"sizeSlug":"large","style":{"border":{"radius":"8px"}}} -->
<figure class="wp-block-image size-large has-custom-border"><a href="{{ITEM_3_LINK}}"><img src="{{ITEM_3_IMAGE}}" alt="{{ITEM_3_ALT}}" style="border-radius:8px"/></a></figure>
<!-- /wp:image -->

<!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading"><a href="{{ITEM_3_LINK}}">{{ITEM_3_HEADING}}</a></h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"textColor":"text-muted","style":{"typography":{"fontSize":"0.875rem"}}} -->
<p class="has-text-muted-color has-text-color" style="font-size:0.875rem">{{ITEM_3_BODY}}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:column -->
</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->
