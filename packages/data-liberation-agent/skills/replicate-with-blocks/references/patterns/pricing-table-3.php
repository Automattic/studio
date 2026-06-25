<?php
/**
 * Title: Pricing — 3-tier cards
 * Slug: <theme-slug>/pricing-table-3
 * Categories: columns, pricing
 * Block Types: core/columns
 * Description: Three pricing tiers with features and CTA per tier.
 *
 * Slots: {{HEADLINE}}, {{TIER_N_LABEL}}, {{PRICE_N}}, {{TIER_N_FEATURES}} (markdown list), {{CTA_LABEL}}, {{CTA_HREF}} for N=1..3.
 */
?>
<!-- wp:group {"align":"full","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--80)","bottom":"var(--wp--preset--spacing--80)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}}} -->
<div class="wp-block-group alignfull" style="padding-top:var(--wp--preset--spacing--80);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--80);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:heading {"textAlign":"center","fontFamily":"display"} -->
<h2 class="wp-block-heading has-text-align-center has-display-font-family">{{HEADLINE}}</h2>
<!-- /wp:heading -->

<!-- wp:columns {"align":"wide"} -->
<div class="wp-block-columns alignwide">
<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:group {"backgroundColor":"surface-raised","style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--40)","bottom":"var(--wp--preset--spacing--40)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}},"border":{"radius":"12px"}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group has-surface-raised-background-color has-background" style="border-radius:12px;padding-top:var(--wp--preset--spacing--40);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--40);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:heading {"level":3,"textAlign":"center"} -->
<h3 class="wp-block-heading has-text-align-center">{{TIER_1_LABEL}}</h3>
<!-- /wp:heading -->

<!-- wp:heading {"level":2,"textAlign":"center","fontFamily":"display"} -->
<h2 class="wp-block-heading has-text-align-center has-display-font-family">{{PRICE_1}}</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul class="wp-block-list">{{TIER_1_FEATURES}}</ul>
<!-- /wp:list -->

<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-buttons">
<!-- wp:button {"backgroundColor":"accent-primary","textColor":"text-inverse"} -->
<div class="wp-block-button"><a class="wp-block-button__link has-text-inverse-color has-accent-primary-background-color has-text-color has-background wp-element-button" href="{{CTA_HREF}}">{{CTA_LABEL}}</a></div>
<!-- /wp:button -->
</div>
<!-- /wp:buttons -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:group {"backgroundColor":"accent-primary","textColor":"text-inverse","style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--40)","bottom":"var(--wp--preset--spacing--40)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}},"border":{"radius":"12px"}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group has-text-inverse-color has-accent-primary-background-color has-text-color has-background" style="border-radius:12px;padding-top:var(--wp--preset--spacing--40);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--40);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:heading {"level":3,"textAlign":"center","textColor":"text-inverse"} -->
<h3 class="wp-block-heading has-text-align-center has-text-inverse-color has-text-color">{{TIER_2_LABEL}}</h3>
<!-- /wp:heading -->

<!-- wp:heading {"level":2,"textAlign":"center","fontFamily":"display","textColor":"text-inverse"} -->
<h2 class="wp-block-heading has-text-align-center has-text-inverse-color has-text-color has-display-font-family">{{PRICE_2}}</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul class="wp-block-list">{{TIER_2_FEATURES}}</ul>
<!-- /wp:list -->

<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-buttons">
<!-- wp:button {"backgroundColor":"surface-base","textColor":"accent-primary"} -->
<div class="wp-block-button"><a class="wp-block-button__link has-accent-primary-color has-surface-base-background-color has-text-color has-background wp-element-button" href="{{CTA_HREF}}">{{CTA_LABEL}}</a></div>
<!-- /wp:button -->
</div>
<!-- /wp:buttons -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:group {"backgroundColor":"surface-raised","style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--40)","bottom":"var(--wp--preset--spacing--40)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}},"border":{"radius":"12px"}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group has-surface-raised-background-color has-background" style="border-radius:12px;padding-top:var(--wp--preset--spacing--40);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--40);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:heading {"level":3,"textAlign":"center"} -->
<h3 class="wp-block-heading has-text-align-center">{{TIER_3_LABEL}}</h3>
<!-- /wp:heading -->

<!-- wp:heading {"level":2,"textAlign":"center","fontFamily":"display"} -->
<h2 class="wp-block-heading has-text-align-center has-display-font-family">{{PRICE_3}}</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul class="wp-block-list">{{TIER_3_FEATURES}}</ul>
<!-- /wp:list -->

<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-buttons">
<!-- wp:button {"backgroundColor":"accent-primary","textColor":"text-inverse"} -->
<div class="wp-block-button"><a class="wp-block-button__link has-text-inverse-color has-accent-primary-background-color has-text-color has-background wp-element-button" href="{{CTA_HREF}}">{{CTA_LABEL}}</a></div>
<!-- /wp:button -->
</div>
<!-- /wp:buttons -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:column -->
</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->
