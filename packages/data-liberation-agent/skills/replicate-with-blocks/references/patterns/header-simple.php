<?php
/**
 * Title: Header — simple logo + nav
 * Slug: <theme-slug>/header-simple
 * Categories: header
 * Block Types: core/template-part/header
 * Description: Minimal header with site title (or logo) + page-list navigation. Same as the scaffold's
 * baseline parts/header.html — included here so the agent can pick a "no-CTA" variant explicitly.
 *
 * IMPORTANT: This pattern OVERRIDES parts/header.html, not post_content. Copy its body markup to
 * parts/header.html in themeFiles[].
 *
 * Slots: none — purely structural.
 */
?>
<!-- wp:group {"align":"full","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--40)","bottom":"var(--wp--preset--spacing--40)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}},"backgroundColor":"surface-base"} -->
<div class="wp-block-group alignfull has-surface-base-background-color has-background" style="padding-top:var(--wp--preset--spacing--40);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--40);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:group {"layout":{"type":"flex","justifyContent":"space-between","flexWrap":"nowrap"}} -->
<div class="wp-block-group">
<!-- wp:site-title {"isLink":true,"style":{"typography":{"fontWeight":"600"}}} /-->

<!-- wp:navigation {"overlayMenu":"mobile","layout":{"type":"flex","justifyContent":"right","orientation":"horizontal"}} -->
<!-- wp:page-list /-->
<!-- /wp:navigation -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:group -->
