<?php
/**
 * Title: Testimonial — single large quote
 * Slug: <theme-slug>/testimonial-single
 * Categories: testimonials
 * Block Types: core/pullquote
 * Description: One pull-quote highlighted, often on accent surface.
 *
 * Slots: {{QUOTE}}, {{QUOTE_ATTR}}.
 */
?>
<!-- wp:pullquote {"align":"full","textColor":"text-inverse","backgroundColor":"surface-inverse","style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--80)","bottom":"var(--wp--preset--spacing--80)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}}} -->
<figure class="wp-block-pullquote alignfull has-text-inverse-color has-surface-inverse-background-color has-text-color has-background" style="padding-top:var(--wp--preset--spacing--80);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--80);padding-left:var(--wp--preset--spacing--40)"><blockquote><p>{{QUOTE}}</p><cite>{{QUOTE_ATTR}}</cite></blockquote></figure>
<!-- /wp:pullquote -->
