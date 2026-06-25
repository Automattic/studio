<?php
/**
 * Title: Hero — cover with image
 * Slug: <theme-slug>/hero-cover
 * Categories: header
 * Block Types: core/cover
 * Description: Full-bleed wp:cover with overlay image and centered text. Use when the source hero has a dominant background image with text laid over it.
 *
 * Slots: {{HEADLINE}}, {{SUBHEAD}}, {{CTA_LABEL}}, {{CTA_HREF}}, {{IMAGE_URL}}, {{IMAGE_ALT}}
 */
?>
<!-- wp:cover {"url":"{{IMAGE_URL}}","alt":"{{IMAGE_ALT}}","dimRatio":40,"overlayColor":"surface-inverse","minHeight":540,"contentPosition":"center center","align":"full","style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--80)","bottom":"var(--wp--preset--spacing--80)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}}} -->
<div class="wp-block-cover alignfull" style="padding-top:var(--wp--preset--spacing--80);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--80);padding-left:var(--wp--preset--spacing--40);min-height:540px"><span aria-hidden="true" class="wp-block-cover__background has-surface-inverse-background-color has-background-dim-40 has-background-dim"></span><img class="wp-block-cover__image-background" alt="{{IMAGE_ALT}}" src="{{IMAGE_URL}}" data-object-fit="cover"/><div class="wp-block-cover__inner-container">
<!-- wp:heading {"textAlign":"center","level":1,"textColor":"text-inverse","fontFamily":"display"} -->
<h1 class="wp-block-heading has-text-align-center has-text-inverse-color has-text-color has-display-font-family">{{HEADLINE}}</h1>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","textColor":"text-inverse","style":{"typography":{"fontSize":"1.25rem","lineHeight":"1.6"}}} -->
<p class="has-text-align-center has-text-inverse-color has-text-color" style="font-size:1.25rem;line-height:1.6">{{SUBHEAD}}</p>
<!-- /wp:paragraph -->

<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-buttons">
<!-- wp:button {"backgroundColor":"accent-primary","textColor":"text-inverse"} -->
<div class="wp-block-button"><a class="wp-block-button__link has-text-inverse-color has-accent-primary-background-color has-text-color has-background wp-element-button" href="{{CTA_HREF}}">{{CTA_LABEL}}</a></div>
<!-- /wp:button -->
</div>
<!-- /wp:buttons -->
</div></div>
<!-- /wp:cover -->
