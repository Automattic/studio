<?php
/**
 * Title: FAQ — accordion
 * Slug: <theme-slug>/faq-accordion
 * Categories: text
 * Block Types: core/details
 * Description: Stack of wp:details items. Each summary is the question, body is the answer.
 *
 * Repeats: 4 items shown — duplicate / drop wp:details blocks to match source FAQ count.
 * Slots: {{HEADLINE}}, {{FAQ_N_QUESTION}}, {{FAQ_N_ANSWER}}.
 */
?>
<!-- wp:group {"align":"full","layout":{"type":"constrained","contentSize":"720px"},"style":{"spacing":{"padding":{"top":"var(--wp--preset--spacing--80)","bottom":"var(--wp--preset--spacing--80)","left":"var(--wp--preset--spacing--40)","right":"var(--wp--preset--spacing--40)"}}}} -->
<div class="wp-block-group alignfull" style="padding-top:var(--wp--preset--spacing--80);padding-right:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--80);padding-left:var(--wp--preset--spacing--40)">
<!-- wp:heading {"textAlign":"center","fontFamily":"display"} -->
<h2 class="wp-block-heading has-text-align-center has-display-font-family">{{HEADLINE}}</h2>
<!-- /wp:heading -->

<!-- wp:details -->
<details class="wp-block-details"><summary>{{FAQ_1_QUESTION}}</summary><!-- wp:paragraph -->
<p>{{FAQ_1_ANSWER}}</p>
<!-- /wp:paragraph --></details>
<!-- /wp:details -->

<!-- wp:details -->
<details class="wp-block-details"><summary>{{FAQ_2_QUESTION}}</summary><!-- wp:paragraph -->
<p>{{FAQ_2_ANSWER}}</p>
<!-- /wp:paragraph --></details>
<!-- /wp:details -->

<!-- wp:details -->
<details class="wp-block-details"><summary>{{FAQ_3_QUESTION}}</summary><!-- wp:paragraph -->
<p>{{FAQ_3_ANSWER}}</p>
<!-- /wp:paragraph --></details>
<!-- /wp:details -->

<!-- wp:details -->
<details class="wp-block-details"><summary>{{FAQ_4_QUESTION}}</summary><!-- wp:paragraph -->
<p>{{FAQ_4_ANSWER}}</p>
<!-- /wp:paragraph --></details>
<!-- /wp:details -->
</div>
<!-- /wp:group -->
