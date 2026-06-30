<?php
/**
 * Title: Footer — minimal
 * Slug: <theme-slug>/footer-minimal
 * Categories: footer
 * Block Types: core/template-part/footer
 * Description: Minimal footer — site title, copyright, and a horizontal nav. No multi-column links.
 * Use when the source's footer is a single horizontal row.
 *
 * IMPORTANT: This pattern OVERRIDES parts/footer.html, not post_content. Copy its body markup to
 * parts/footer.html in themeFiles[].
 *
 * Slots: {{COPYRIGHT}}.
 */
?>
<!-- wp:group {"align":"full","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--40)","bottom":"var(--wp--preset--spacing--40)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}},"backgroundColor":"surface-inverse","textColor":"text-inverse"} -->
<div class="wp-block-group alignfull has-text-inverse-color has-surface-inverse-background-color has-text-color has-background" style="padding-top:var(--wp--preset--spacing--40);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--40);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:group {"layout":{"type":"flex","justifyContent":"space-between","flexWrap":"wrap"}} -->
<div class="wp-block-group">
<!-- wp:site-title {"isLink":true,"style":{"typography":{"fontWeight":"600"},"color":{"text":"var(--wp--preset--color--text-inverse)"}}} /-->

<!-- wp:paragraph {"style":{"typography":{"fontSize":"0.875rem"}}} -->
<p style="font-size:0.875rem">&copy; <?php echo (int) date('Y'); ?> {{COPYRIGHT}}.</p>
<!-- /wp:paragraph -->

<!-- wp:navigation {"overlayMenu":"never","layout":{"type":"flex","justifyContent":"right","orientation":"horizontal"}} /-->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:group -->
