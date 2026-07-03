<?php
/**
 * Title: About — split image + story
 * Slug: <theme-slug>/about-split
 * Categories: text
 * Block Types: core/columns
 * Description: Image + about-us narrative + CTA. Often the second section of an About page.
 *
 * Slots: {{HEADLINE}}, {{BODY}}, {{CTA_LABEL}}, {{CTA_HREF}}, {{IMAGE_URL}}, {{IMAGE_ALT}}.
 */
?>
<!-- wp:group {"align":"full","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--80)","bottom":"var(--wp--preset--spacing--80)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}}} -->
<div class="wp-block-group alignfull" style="padding-top:var(--wp--preset--spacing--80);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--80);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:columns {"align":"wide","verticalAlignment":"center"} -->
<div class="wp-block-columns alignwide are-vertically-aligned-center">
<!-- wp:column {"verticalAlignment":"center"} -->
<div class="wp-block-column is-vertically-aligned-center">
<!-- wp:image {"sizeSlug":"large"} -->
<figure class="wp-block-image size-large"><img src="{{IMAGE_URL}}" alt="{{IMAGE_ALT}}"/></figure>
<!-- /wp:image -->
</div>
<!-- /wp:column -->

<!-- wp:column {"verticalAlignment":"center"} -->
<div class="wp-block-column is-vertically-aligned-center">
<!-- wp:heading {"fontFamily":"display"} -->
<h2 class="wp-block-heading has-display-font-family">{{HEADLINE}}</h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"textColor":"text-muted","style":{"typography":{"lineHeight":"1.7"}}} -->
<p class="has-text-muted-color has-text-color" style="line-height:1.7">{{BODY}}</p>
<!-- /wp:paragraph -->

<!-- wp:buttons -->
<div class="wp-block-buttons">
<!-- wp:button {"backgroundColor":"accent-primary","textColor":"text-inverse"} -->
<div class="wp-block-button"><a class="wp-block-button__link has-text-inverse-color has-accent-primary-background-color has-text-color has-background wp-element-button" href="{{CTA_HREF}}">{{CTA_LABEL}}</a></div>
<!-- /wp:button -->
</div>
<!-- /wp:buttons -->
</div>
<!-- /wp:column -->
</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->
