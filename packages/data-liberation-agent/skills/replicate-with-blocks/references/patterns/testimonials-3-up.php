<?php
/**
 * Title: Testimonials — 3-column quotes
 * Slug: <theme-slug>/testimonials-3-up
 * Categories: columns, testimonials
 * Block Types: core/columns
 * Description: Three customer quotes side-by-side with attribution.
 *
 * Slots: {{HEADLINE}}, {{QUOTE_N}}, {{QUOTE_N_ATTR}} for N=1..3.
 */
?>
<!-- wp:group {"align":"full","backgroundColor":"surface-raised","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--80)","bottom":"var(--wp--preset--spacing--80)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}}} -->
<div class="wp-block-group alignfull has-surface-raised-background-color has-background" style="padding-top:var(--wp--preset--spacing--80);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--80);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:heading {"textAlign":"center","fontFamily":"display"} -->
<h2 class="wp-block-heading has-text-align-center has-display-font-family">{{HEADLINE}}</h2>
<!-- /wp:heading -->

<!-- wp:columns {"align":"wide"} -->
<div class="wp-block-columns alignwide">
<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:quote -->
<blockquote class="wp-block-quote"><!-- wp:paragraph -->
<p>{{QUOTE_1}}</p>
<!-- /wp:paragraph --><cite>{{QUOTE_1_ATTR}}</cite></blockquote>
<!-- /wp:quote -->
</div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:quote -->
<blockquote class="wp-block-quote"><!-- wp:paragraph -->
<p>{{QUOTE_2}}</p>
<!-- /wp:paragraph --><cite>{{QUOTE_2_ATTR}}</cite></blockquote>
<!-- /wp:quote -->
</div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:quote -->
<blockquote class="wp-block-quote"><!-- wp:paragraph -->
<p>{{QUOTE_3}}</p>
<!-- /wp:paragraph --><cite>{{QUOTE_3_ATTR}}</cite></blockquote>
<!-- /wp:quote -->
</div>
<!-- /wp:column -->
</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->
