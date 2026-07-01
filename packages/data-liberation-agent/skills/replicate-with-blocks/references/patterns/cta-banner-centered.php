<?php
/**
 * Title: CTA — centered banner
 * Slug: <theme-slug>/cta-banner-centered
 * Categories: call-to-action
 * Block Types: core/group
 * Description: Full-bleed accent band with centered headline + button. Closing CTA before footer.
 *
 * Slots: {{HEADLINE}}, {{SUBHEAD}}, {{CTA_LABEL}}, {{CTA_HREF}}.
 */
?>
<!-- wp:group {"align":"full","backgroundColor":"accent-primary","textColor":"text-inverse","layout":{"type":"constrained","contentSize":"720px"},"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--80)","bottom":"var(--wp--preset--spacing--80)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}}} -->
<div class="wp-block-group alignfull has-text-inverse-color has-accent-primary-background-color has-text-color has-background" style="padding-top:var(--wp--preset--spacing--80);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--80);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:heading {"textAlign":"center","fontFamily":"display"} -->
<h2 class="wp-block-heading has-text-align-center has-display-font-family">{{HEADLINE}}</h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center"} -->
<p class="has-text-align-center">{{SUBHEAD}}</p>
<!-- /wp:paragraph -->

<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-buttons">
<!-- wp:button {"backgroundColor":"surface-base","textColor":"accent-primary"} -->
<div class="wp-block-button"><a class="wp-block-button__link has-accent-primary-color has-surface-base-background-color has-text-color has-background wp-element-button" href="{{CTA_HREF}}">{{CTA_LABEL}}</a></div>
<!-- /wp:button -->
</div>
<!-- /wp:buttons -->
</div>
<!-- /wp:group -->
