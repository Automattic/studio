export interface HtmlBlockPolicyRecommendation {
	/**
	 * Raw HTML patterns that should be represented by editable blocks instead of
	 * core/html.
	 */
	htmlPatterns: RegExp[];
	/** Error message emitted when htmlPatterns match. */
	htmlPolicyMessage: string;
}

export const HTML_BLOCK_POLICY_RECOMMENDATIONS: HtmlBlockPolicyRecommendation[] = [
	{
		htmlPatterns: [ /<(form|input|select|textarea|fieldset)\b/i ],
		htmlPolicyMessage:
			'core/html contains form markup. Load the plugin-recommendations skill and use editable plugin blocks such as Jetpack Forms or jetpack/subscriptions. This keeps forms editable in the block editor and handles submission without custom backend code.',
	},
];
