const BLOCK_COMMENT_PATTERN = /<!--\s*\/?wp:[^>]*-->/g;
const SINGLE_SCRIPT_PATTERN = /^<script(?:\s[^>]*)?>[\s\S]*<\/script>\s*$/i;
const SINGLE_SVG_PATTERN = /^<svg(?:\s[^>]*)?>[\s\S]*<\/svg>\s*$/i;
const INTERACTION_MARKUP_PATTERN = /<(marquee)\b/i;
const HTML_BLOCK_PATTERN = /<!--\s*wp:html(?:\s+[\s\S]*?)?\s*-->([\s\S]*?)<!--\s*\/wp:html\s*-->/g;
const PLUGIN_RECOMMENDATION_HTML_BLOCK_POLICIES = [
	{
		htmlPatterns: [ /<(form|input|select|textarea|fieldset)\b/i ],
		htmlPolicyMessage:
			'core/html contains form markup. Load the plugin-recommendations skill and use editable plugin blocks such as Jetpack Forms. This keeps forms editable in the block editor and handles submission without custom backend code.',
	},
];

export interface HtmlBlockPolicyResult {
	blockNumber: number;
	line: number;
	content: string;
	issues: string[];
}

export interface HtmlBlockPolicyReport {
	totalHtmlBlocks: number;
	invalidHtmlBlocks: HtmlBlockPolicyResult[];
}

export function getHtmlBlockPolicyIssues( content: string ): string[] {
	const html = content.replace( BLOCK_COMMENT_PATTERN, '' ).trim();
	if ( ! html ) {
		return [];
	}

	if (
		SINGLE_SCRIPT_PATTERN.test( html ) ||
		SINGLE_SVG_PATTERN.test( html ) ||
		INTERACTION_MARKUP_PATTERN.test( html )
	) {
		return [];
	}

	// Check plugin-specific patterns first so we return a targeted message.
	for ( const recommendation of PLUGIN_RECOMMENDATION_HTML_BLOCK_POLICIES ) {
		if ( recommendation.htmlPatterns.some( ( pattern ) => pattern.test( html ) ) ) {
			return [ recommendation.htmlPolicyMessage ];
		}
	}

	return [
		'core/html contains markup that should use editable core blocks. Load the block-content skill and use core/group, core/columns, core/heading, core/paragraph, core/list, core/image, core/buttons, and theme CSS instead. Keep core/html only for inline SVG, interaction markup with no block equivalent (marquee, cursor), or a single script block.',
	];
}

export function validateHtmlBlockPolicy( content: string ): HtmlBlockPolicyReport {
	const invalidHtmlBlocks: HtmlBlockPolicyResult[] = [];
	let totalHtmlBlocks = 0;

	for ( const match of content.matchAll( HTML_BLOCK_PATTERN ) ) {
		totalHtmlBlocks++;
		const blockContent = match[ 1 ] ?? '';
		const issues = getHtmlBlockPolicyIssues( blockContent );
		if ( issues.length === 0 ) {
			continue;
		}

		invalidHtmlBlocks.push( {
			blockNumber: totalHtmlBlocks,
			line: content.slice( 0, match.index ?? 0 ).split( '\n' ).length,
			content: blockContent.trim(),
			issues,
		} );
	}

	return {
		totalHtmlBlocks,
		invalidHtmlBlocks,
	};
}
