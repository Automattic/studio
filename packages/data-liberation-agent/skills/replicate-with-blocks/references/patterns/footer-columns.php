<?php
/**
 * Title: Footer — multi-column
 * Slug: <theme-slug>/footer-columns
 * Categories: footer
 * Block Types: core/template-part/footer
 * Description: Multi-column footer with site links, social icons, and copyright. Drop into
 * parts/footer.html.
 *
 * IMPORTANT: This pattern OVERRIDES parts/footer.html, not post_content. Copy its body markup to
 * parts/footer.html in themeFiles[].
 *
 * Slots: {{COL_1_HEADING}}, {{COL_2_HEADING}}, {{COL_3_HEADING}} (e.g. "Shop", "Support", "Company"),
 * plus link lists per column the agent fills as wp:list children.
 */
?>
<!-- wp:group {"align":"full","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--80)","bottom":"var(--wp--preset--spacing--40)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}},"backgroundColor":"surface-inverse","textColor":"text-inverse"} -->
<div class="wp-block-group alignfull has-text-inverse-color has-surface-inverse-background-color has-text-color has-background" style="padding-top:var(--wp--preset--spacing--80);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--40);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:columns {"align":"wide"} -->
<div class="wp-block-columns alignwide">
<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:site-title {"isLink":true,"style":{"typography":{"fontWeight":"700"},"color":{"text":"var(--wp--preset--color--text-inverse)"}}} /-->

<!-- wp:site-tagline /-->
</div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:heading {"level":4,"textColor":"text-inverse"} -->
<h4 class="wp-block-heading has-text-inverse-color has-text-color">{{COL_1_HEADING}}</h4>
<!-- /wp:heading -->

<!-- wp:list -->
<ul class="wp-block-list">{{COL_1_LINKS}}</ul>
<!-- /wp:list -->
</div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:heading {"level":4,"textColor":"text-inverse"} -->
<h4 class="wp-block-heading has-text-inverse-color has-text-color">{{COL_2_HEADING}}</h4>
<!-- /wp:heading -->

<!-- wp:list -->
<ul class="wp-block-list">{{COL_2_LINKS}}</ul>
<!-- /wp:list -->
</div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:heading {"level":4,"textColor":"text-inverse"} -->
<h4 class="wp-block-heading has-text-inverse-color has-text-color">{{COL_3_HEADING}}</h4>
<!-- /wp:heading -->

<!-- wp:list -->
<ul class="wp-block-list">{{COL_3_LINKS}}</ul>
<!-- /wp:list -->
</div>
<!-- /wp:column -->
</div>
<!-- /wp:columns -->

<!-- wp:separator {"style":{"color":{"background":"var(--wp--preset--color--border-subtle)"}},"className":"is-style-default"} -->
<hr class="wp-block-separator has-text-color has-alpha-channel-opacity has-background is-style-default" style="background-color:var(--wp--preset--color--border-subtle);color:var(--wp--preset--color--border-subtle)"/>
<!-- /wp:separator -->

<!-- wp:paragraph {"align":"center","style":{"typography":{"fontSize":"0.875rem"}}} -->
<p class="has-text-align-center" style="font-size:0.875rem">&copy; <?php echo (int) date('Y'); ?> {{COPYRIGHT}}. All rights reserved.</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->
