const BLOCK_COMMENT_PATTERN = /<!--\s*\/?wp:[^>]*-->/g;
const SINGLE_SCRIPT_PATTERN = /^<script(?:\s[^>]*)?>[\s\S]*<\/script>\s*$/i;
const SINGLE_SVG_PATTERN = /^<svg(?:\s[^>]*)?>[\s\S]*<\/svg>\s*$/i;
const FORM_MARKUP_PATTERN = /<(form|input|select|textarea|label|fieldset|legend|option)\b/i;
const INTERACTION_MARKUP_PATTERN = /<(marquee)\b/i;

export function getHtmlBlockPolicyIssues( content: string ): string[] {
	const html = content.replace( BLOCK_COMMENT_PATTERN, '' ).trim();
	if ( ! html || isAllowedHtmlBlockContent( html ) ) {
		return [];
	}

	return [
		'core/html contains markup that should use editable core blocks. Use core/group, core/columns, core/heading, core/paragraph, core/list, core/image, core/buttons, and theme CSS instead. Keep core/html only for inline SVG, form/input markup, interaction markup with no block equivalent, or a single script block.',
	];
}

function isAllowedHtmlBlockContent( html: string ): boolean {
	return (
		SINGLE_SCRIPT_PATTERN.test( html ) ||
		SINGLE_SVG_PATTERN.test( html ) ||
		FORM_MARKUP_PATTERN.test( html ) ||
		INTERACTION_MARKUP_PATTERN.test( html )
	);
}
