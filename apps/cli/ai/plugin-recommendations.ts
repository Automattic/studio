export interface PluginRecommendation {
	/** Human-readable plugin name. */
	name: string;
	/** WP-CLI installable slug (e.g. "jetpack"). */
	pluginSlug: string;
	/** Block names made available after activation. */
	blocks: string[];
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
			'core/button',
		],
		guidance: `## Forms

When the user asks for a contact form, feedback form, newsletter signup, survey, or any other interactive form, you MUST use Jetpack Forms — not raw HTML <form> elements.

Install the plugin first if it is not already active:
\`\`\`
wp_cli plugin install jetpack --activate
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
The container jetpack/contact-form supports: "subject" (email subject line), "to" (recipient address or comma-separated list).`,
		htmlPatterns: [ /<(form|input|select|textarea|fieldset)\b/i ],
		htmlPolicyMessage:
			'core/html contains a <form> element. Use Jetpack Forms blocks instead: install the "jetpack" plugin and build the form with jetpack/contact-form and jetpack/field-* blocks. This keeps forms editable in the block editor and handles submission without custom backend code.',
	},
	{
		name: 'WooCommerce',
		pluginSlug: 'woocommerce',
		blocks: [
			'woocommerce/product-collection',
			'woocommerce/all-products',
			'woocommerce/featured-product',
			'woocommerce/featured-category',
			'woocommerce/cart',
			'woocommerce/checkout',
			'woocommerce/customer-account',
			'woocommerce/mini-cart',
			'woocommerce/product-search',
			'woocommerce/product-categories',
		],
		guidance: `## E-commerce / Shops

When the user asks for a shop, product listing, cart, checkout, or any e-commerce feature, you MUST use WooCommerce — not hand-coded product layouts.

Install and activate WooCommerce first if it is not already active:
\`\`\`
wp_cli plugin install woocommerce --activate
\`\`\`

Then build shop pages using WooCommerce blocks:

- **Product grid / shop page**: \`woocommerce/product-collection\` (modern, filter-aware) or \`woocommerce/all-products\` (legacy)
- **Featured product highlight**: \`woocommerce/featured-product\` (requires a product ID)
- **Cart page**: \`woocommerce/cart\`
- **Checkout page**: \`woocommerce/checkout\`
- **Mini-cart in header**: \`woocommerce/mini-cart\`
- **Product search**: \`woocommerce/product-search\`
- **Category navigation**: \`woocommerce/product-categories\`

After activation, create a few demo products with WP-CLI so the user can see a real preview:
\`\`\`
wp_cli wc product create --name="Sample Product" --regular_price=29.99 --user=1
\`\`\`

Use WP-CLI's \`wc\` sub-commands (not \`post create\`) to manage products, orders, and coupons so all WooCommerce metadata is set correctly.`,
	},
];

/**
 * Returns the system-prompt section generated from all plugin recommendations.
 */
export function buildPluginRecommendationsSection(): string {
	return PLUGIN_RECOMMENDATIONS.map( ( r ) => r.guidance ).join( '\n\n' );
}
