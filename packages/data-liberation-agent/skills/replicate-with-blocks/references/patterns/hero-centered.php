<?php
/**
 * Title: Hero — centered headline
 * Slug: <theme-slug>/hero-centered
 * Categories: header
 * Block Types: core/group
 * Description: Full-bleed solid/gradient background with centered headline + subhead + CTA. Use when the source hero has no dominant image.
 *
 * Slots: {{HEADLINE}}, {{SUBHEAD}}, {{CTA_LABEL}}, {{CTA_HREF}}
 */
?>
<!-- wp:group {"align":"full","backgroundColor":"surface-base","layout":{"type":"constrained","contentSize":"720px"},"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--80)","bottom":"var(--wp--preset--spacing--80)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}}} -->
<div class="wp-block-group alignfull has-surface-base-background-color has-background" style="padding-top:var(--wp--preset--spacing--80);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--80);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:heading {"textAlign":"center","level":1,"fontFamily":"display"} -->
<h1 class="wp-block-heading has-text-align-center has-display-font-family">{{HEADLINE}}</h1>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","textColor":"text-muted","style":{"typography":{"fontSize":"1.25rem","lineHeight":"1.6"}}} -->
<p class="has-text-align-center has-text-muted-color has-text-color" style="font-size:1.25rem;line-height:1.6">{{SUBHEAD}}</p>
<!-- /wp:paragraph -->

<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-buttons">
<!-- wp:button {"backgroundColor":"accent-primary","textColor":"text-inverse"} -->
<div class="wp-block-button"><a class="wp-block-button__link has-text-inverse-color has-accent-primary-background-color has-text-color has-background wp-element-button" href="{{CTA_HREF}}">{{CTA_LABEL}}</a></div>
<!-- /wp:button -->
</div>
<!-- /wp:buttons -->
</div>
<!-- /wp:group -->
