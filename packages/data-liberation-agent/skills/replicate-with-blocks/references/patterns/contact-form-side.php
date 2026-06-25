<?php
/**
 * Title: Contact — form-styled with sidebar info
 * Slug: <theme-slug>/contact-form-side
 * Categories: text
 * Block Types: core/columns
 * Description: Form-styled column (cosmetic only) with contact info in sidebar. Mark interactive bits as buttons since post_content can't include real forms.
 *
 * NOTE: post_content cannot include real <form>, <input>, <textarea>, or <select> elements (the
 * importer strips them). The form-styled column shows visual placeholders (paragraph blocks with
 * border treatment) instead of real inputs. The agent can add a "Send" button as a CTA.
 *
 * Slots: {{HEADLINE}}, {{SUBHEAD}}, {{CTA_LABEL}}, {{ADDRESS}}, {{PHONE}}, {{EMAIL}}.
 */
?>
<!-- wp:group {"align":"full","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--80)","bottom":"var(--wp--preset--spacing--80)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}}} -->
<div class="wp-block-group alignfull" style="padding-top:var(--wp--preset--spacing--80);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--80);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:columns {"align":"wide"} -->
<div class="wp-block-columns alignwide">
<!-- wp:column {"width":"60%"} -->
<div class="wp-block-column" style="flex-basis:60%">
<!-- wp:heading {"fontFamily":"display"} -->
<h2 class="wp-block-heading has-display-font-family">{{HEADLINE}}</h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"textColor":"text-muted"} -->
<p class="has-text-muted-color has-text-color">{{SUBHEAD}}</p>
<!-- /wp:paragraph -->

<!-- wp:buttons -->
<div class="wp-block-buttons">
<!-- wp:button {"backgroundColor":"accent-primary","textColor":"text-inverse"} -->
<div class="wp-block-button"><a class="wp-block-button__link has-text-inverse-color has-accent-primary-background-color has-text-color has-background wp-element-button" href="mailto:{{EMAIL}}">{{CTA_LABEL}}</a></div>
<!-- /wp:button -->
</div>
<!-- /wp:buttons -->
</div>
<!-- /wp:column -->

<!-- wp:column {"width":"40%","backgroundColor":"surface-raised","style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--40)","bottom":"var(--wp--preset--spacing--40)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}},"border":{"radius":"12px"}}} -->
<div class="wp-block-column has-surface-raised-background-color has-background" style="border-radius:12px;padding-top:var(--wp--preset--spacing--40);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--40);padding-left:var(--wp--preset--spacing--40);flex-basis:40%">
<!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading">Get in touch</h3>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>{{ADDRESS}}</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>{{PHONE}}</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p><a href="mailto:{{EMAIL}}">{{EMAIL}}</a></p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:column -->
</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->
