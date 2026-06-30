<?php
/**
 * Title: Header — with CTA button
 * Slug: <theme-slug>/header-cta
 * Categories: header
 * Block Types: core/template-part/header
 * Description: Header with site title, navigation, and a primary CTA button. Drop into parts/header.html
 * when the source has a prominent header CTA (e.g. "Get Started", "Book Demo").
 *
 * IMPORTANT: This pattern is meant to OVERRIDE parts/header.html, not appear in post_content.
 * The agent installs it by copying its body block-markup to parts/header.html in themeFiles[].
 *
 * Slots: {{CTA_LABEL}}, {{CTA_HREF}}.
 */
?>
<!-- wp:group {"align":"full","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--40)","bottom":"var(--wp--preset--spacing--40)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}},"backgroundColor":"surface-base"} -->
<div class="wp-block-group alignfull has-surface-base-background-color has-background" style="padding-top:var(--wp--preset--spacing--40);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--40);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:group {"layout":{"type":"flex","justifyContent":"space-between","flexWrap":"nowrap"}} -->
<div class="wp-block-group">
<!-- wp:site-title {"isLink":true,"style":{"typography":{"fontWeight":"600"}}} /-->

<!-- wp:group {"layout":{"type":"flex","flexWrap":"nowrap"}} -->
<div class="wp-block-group">
<!-- wp:navigation {"overlayMenu":"mobile","layout":{"type":"flex","justifyContent":"right","orientation":"horizontal"}} -->
<!-- wp:page-list /-->
<!-- /wp:navigation -->

<!-- wp:buttons -->
<div class="wp-block-buttons">
<!-- wp:button {"backgroundColor":"accent-primary","textColor":"text-inverse","style":{"typography":{"fontSize":"0.9rem"}}} -->
<div class="wp-block-button has-custom-font-size" style="font-size:0.9rem"><a class="wp-block-button__link has-text-inverse-color has-accent-primary-background-color has-text-color has-background wp-element-button" href="{{CTA_HREF}}">{{CTA_LABEL}}</a></div>
<!-- /wp:button -->
</div>
<!-- /wp:buttons -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:group -->
