<?php
/**
 * Title: Pricing — feature comparison
 * Slug: <theme-slug>/pricing-table-comparison
 * Categories: pricing
 * Block Types: core/table
 * Description: Tier-by-feature comparison table layout.
 *
 * Slots: {{HEADLINE}}, {{TIER_N_LABEL}}, {{PRICE_N}}, plus row data the agent fills as table rows.
 * The wp:table cells contain plain text — the agent should generate <tr><td>...</td></tr> rows that
 * match the source's feature list.
 */
?>
<!-- wp:group {"align":"full","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--80)","bottom":"var(--wp--preset--spacing--80)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}}} -->
<div class="wp-block-group alignfull" style="padding-top:var(--wp--preset--spacing--80);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--80);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:heading {"textAlign":"center","fontFamily":"display"} -->
<h2 class="wp-block-heading has-text-align-center has-display-font-family">{{HEADLINE}}</h2>
<!-- /wp:heading -->

<!-- wp:table {"align":"wide","className":"is-style-stripes"} -->
<figure class="wp-block-table alignwide is-style-stripes"><table><thead><tr><th>Feature</th><th>{{TIER_1_LABEL}} {{PRICE_1}}</th><th>{{TIER_2_LABEL}} {{PRICE_2}}</th><th>{{TIER_3_LABEL}} {{PRICE_3}}</th></tr></thead><tbody>{{ROWS}}</tbody></table></figure>
<!-- /wp:table -->
</div>
<!-- /wp:group -->
