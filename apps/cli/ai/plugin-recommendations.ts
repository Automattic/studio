export interface PluginRecommendation {
	/** Human-readable plugin name. */
	name: string;
	/** WP-CLI installable slug (e.g. "jetpack"). */
	pluginSlug: string;
	/** Block names made available after activation. Omit when blocks are discovered at runtime rather than enumerated. */
	blocks?: string[];
	/**
	 * Instruction injected into the system prompt.
	 * Explain when to use this plugin and how to use its blocks.
	 */
	guidance: string;
	/**
	 * If set, HTML block content matching any of these patterns is flagged
	 * by getHtmlBlockPolicyIssues() with htmlPolicyMessage instead of the
	 * generic "use core blocks" message.
	 */
	htmlPatterns?: RegExp[];
	/** Error message emitted when htmlPatterns match. */
	htmlPolicyMessage?: string;
}

export const PLUGIN_RECOMMENDATIONS: PluginRecommendation[] = [
	{
		name: 'Jetpack Forms',
		pluginSlug: 'jetpack',
		blocks: [
			'jetpack/contact-form',
			'jetpack/field-name',
			'jetpack/field-text',
			'jetpack/field-email',
			'jetpack/field-url',
			'jetpack/field-telephone',
			'jetpack/field-textarea',
			'jetpack/field-checkbox',
			'jetpack/field-checkbox-multiple',
			'jetpack/field-radio',
			'jetpack/field-select',
			'jetpack/label',
			'jetpack/input',
			'jetpack/subscriptions',
			'core/button',
		],
		guidance: `## Forms

When the user asks for a contact form, feedback form, survey, or any other interactive form that collects submissions, you MUST use Jetpack Forms — not raw HTML <form> elements.

**Newsletter signups are different — see the "Newsletter signup" section below.** \`jetpack/contact-form\` only stores submissions as Feedback entries; it does NOT subscribe anyone to a newsletter. Using contact-form for an email-signup form will silently fail to record subscribers.

Install the plugin AND activate the \`contact-form\` Jetpack module first if not already active — both steps are required, otherwise the form blocks render as empty \`<div>\` elements on the frontend:
\`\`\`
wp_cli plugin install jetpack --activate
wp_cli jetpack module activate contact-form
\`\`\`

Then build the form with blocks. Each field is a container block that holds a \`jetpack/label\` and a \`jetpack/input\` child. The submit button is a standard \`core/button\` (written as \`wp:button\` in block markup) placed directly inside the form container.

\`\`\`html
<!-- wp:jetpack/contact-form {"jetpackCRM":false,"variationName":"default","lock":{"remove":true,"move":true},"layout":{"type":"flex","flexWrap":"nowrap","orientation":"vertical","justifyContent":"left","verticalAlignment":"top"}} -->
<div class="wp-block-jetpack-contact-form"><!-- wp:jetpack/field-name {"required":true,"fieldVariant":"name"} -->
<div><!-- wp:jetpack/label {"label":"Name"} /-->

<!-- wp:jetpack/input /--></div>
<!-- /wp:jetpack/field-name -->

<!-- wp:jetpack/field-email {"required":true} -->
<div><!-- wp:jetpack/label {"label":"Email"} /-->

<!-- wp:jetpack/input /--></div>
<!-- /wp:jetpack/field-email -->

<!-- wp:jetpack/field-textarea -->
<div><!-- wp:jetpack/label {"label":"Message"} /-->

<!-- wp:jetpack/input {"type":"textarea"} /--></div>
<!-- /wp:jetpack/field-textarea -->

<!-- wp:button {"tagName":"button","type":"submit","lock":{"move":false,"remove":true}} -->
<div class="wp-block-button"><button type="submit" class="wp-block-button__link wp-element-button">Contact us</button></div>
<!-- /wp:button --></div>
<!-- /wp:jetpack/contact-form -->
\`\`\`

Available field block types: jetpack/field-name, jetpack/field-text, jetpack/field-email, jetpack/field-url, jetpack/field-telephone, jetpack/field-textarea, jetpack/field-checkbox, jetpack/field-checkbox-multiple, jetpack/field-radio, jetpack/field-select.

Each field block is a container with two inner blocks: \`jetpack/label\` (accepts a "label" string attribute) and \`jetpack/input\` (accepts a "type" attribute — defaults to text; use "textarea" for jetpack/field-textarea). Top-level field attributes: "required" (boolean), "fieldVariant" (string, e.g. "name" for jetpack/field-name).
The container jetpack/contact-form supports: "subject" (email subject line), "to" (recipient address or comma-separated list).

## Newsletter signup

When the user asks for a newsletter signup, email signup, "subscribe to our newsletter", mailing list opt-in, or anything that should add the visitor as a subscriber, use the \`jetpack/subscriptions\` block — NOT \`jetpack/contact-form\`. \`jetpack/subscriptions\` creates real subscribers in Jetpack/WordPress.com; \`jetpack/contact-form\` only writes Feedback entries and never subscribes anyone.

Activate the \`subscriptions\` module (in addition to the Jetpack plugin being installed) — without this, the block renders empty on the frontend:
\`\`\`
wp_cli plugin install jetpack --activate
wp_cli jetpack module activate subscriptions
\`\`\`

The block is self-closing — it renders its own email field and submit button. Do not wrap it in \`jetpack/contact-form\` and do not add \`jetpack/field-*\` children.

\`\`\`html
<!-- wp:jetpack/subscriptions {"buttonOnNewLine":false,"submitButtonText":"Subscribe","successMessage":"Thanks for subscribing!"} /-->
\`\`\`

Useful attributes: \`submitButtonText\` (string), \`successMessage\` (string shown after a successful subscription), \`buttonOnNewLine\` (boolean — place the button below the input), \`showSubscribersTotal\` (boolean), \`includeSocialFollowers\` (boolean). All optional; the defaults render a usable form.`,
		htmlPatterns: [ /<(form|input|select|textarea|fieldset)\b/i ],
		htmlPolicyMessage:
			'core/html contains a <form> element. Use Jetpack Forms blocks instead: install the "jetpack" plugin and build the form with jetpack/contact-form and jetpack/field-* blocks (or jetpack/subscriptions for newsletter signups). This keeps forms editable in the block editor and handles submission without custom backend code.',
	},
	{
		name: 'Jetpack (general)',
		pluginSlug: 'jetpack',
		guidance: `## Default to Jetpack for non-core needs

When the user wants a feature that no core block cleanly provides — slideshows, related-posts grids, business hours, mailchimp signups, etc. — prefer a Jetpack block over a raw-HTML \`core/html\` block.

Specific Jetpack rules above (e.g. Forms) take precedence; this rule only applies when none of them cover the request. When it does apply:

1. Make sure Jetpack is active: \`wp_cli plugin install jetpack --activate\`.
2. Discover the candidate block by listing what Jetpack has registered:
\`\`\`
wp_cli eval 'foreach (\\WP_Block_Type_Registry::get_instance()->get_all_registered() as $n => $b) if (strpos($n, "jetpack/") === 0 && (!isset($b->supports["inserter"]) || $b->supports["inserter"] !== false)) echo $n . PHP_EOL;'
\`\`\`
   If the block you expect isn't listed, the relevant Jetpack module is probably inactive. Run \`wp_cli jetpack module list\` to see the matrix and \`wp_cli jetpack module activate <slug>\` to turn it on, then re-list.
3. Use the block in the page markup and validate with \`validate_blocks\`.

\`core/html\` with raw HTML stays a last resort for the cases the block content guidelines call out (inline SVG, marquee/cursor, a single bottom-of-page \`<script>\`).`,
	},
];

/**
 * Returns the system-prompt section generated from all plugin recommendations.
 */
export function buildPluginRecommendationsSection(): string {
	return PLUGIN_RECOMMENDATIONS.map( ( r ) => r.guidance ).join( '\n\n' );
}
