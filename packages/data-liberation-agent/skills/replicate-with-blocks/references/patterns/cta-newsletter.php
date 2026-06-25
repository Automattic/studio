<?php
/**
 * Title: CTA — newsletter signup
 * Slug: <theme-slug>/cta-newsletter
 * Categories: call-to-action
 * Block Types: core/group
 * Description: Heading + email-capture-styled button row. Use when the source has a newsletter form.
 *
 * NOTE: post_content cannot include real <form> elements (the importer strips them). Mark up the email
 * field as a styled button-row that visually matches the source. The agent should NOT add an <input> —
 * use the buttons block as a stand-in.
 *
 * Slots: {{HEADLINE}}, {{SUBHEAD}}, {{CTA_LABEL}}, {{CTA_HREF}}.
 */
?>
<!-- wp:group {"align":"full","backgroundColor":"surface-raised","layout":{"type":"constrained","contentSize":"640px"},"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--60)","bottom":"var(--wp--preset--spacing--60)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}}} -->
<div class="wp-block-group alignfull has-surface-raised-background-color has-background" style="padding-top:var(--wp--preset--spacing--60);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--60);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:heading {"textAlign":"center","fontFamily":"display"} -->
<h2 class="wp-block-heading has-text-align-center has-display-font-family">{{HEADLINE}}</h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","textColor":"text-muted"} -->
<p class="has-text-align-center has-text-muted-color has-text-color">{{SUBHEAD}}</p>
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
