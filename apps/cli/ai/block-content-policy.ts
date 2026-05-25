import { HTML_BLOCK_POLICY_RECOMMENDATIONS } from './plugin-recommendations';

const BLOCK_COMMENT_PATTERN = /<!--\s*\/?wp:[^>]*-->/g;
const SINGLE_SCRIPT_PATTERN = /^<script(?:\s[^>]*)?>[\s\S]*<\/script>\s*$/i;
const SINGLE_SVG_PATTERN = /^<svg(?:\s[^>]*)?>[\s\S]*<\/svg>\s*$/i;
const INTERACTION_MARKUP_PATTERN = /<(marquee)\b/i;

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
	for ( const recommendation of HTML_BLOCK_POLICY_RECOMMENDATIONS ) {
		if ( recommendation.htmlPatterns.some( ( pattern ) => pattern.test( html ) ) ) {
			return [ recommendation.htmlPolicyMessage ];
		}
	}

	return [
		'core/html contains markup that should use editable core blocks. Load the block-content skill and use core/group, core/columns, core/heading, core/paragraph, core/list, core/image, core/buttons, and theme CSS instead. Keep core/html only for inline SVG, interaction markup with no block equivalent (marquee, cursor), or a single script block.',
	];
}
