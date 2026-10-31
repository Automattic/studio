import { PREFERRED_PLUGINS, type PreferredPlugin } from '@studio/agent/node/preferred-plugins';

const BLOCK_COMMENT_PATTERN = /<!--\s*\/?wp:[^>]*-->/g;
const SINGLE_SCRIPT_PATTERN = /^<script(?:\s[^>]*)?>[\s\S]*<\/script>\s*$/i;
const SINGLE_SVG_PATTERN = /^<svg(?:\s[^>]*)?>[\s\S]*<\/svg>\s*$/i;
const INTERACTION_MARKUP_PATTERN = /<(marquee)\b/i;
const HTML_BLOCK_PATTERN = /<!--\s*wp:html(?:\s+[\s\S]*?)?\s*-->([\s\S]*?)<!--\s*\/wp:html\s*-->/g;

// A form whose action is "#", empty or missing submits to the page it is on
// (the HTML standard's form submission algorithm), where WordPress reads none
// of its fields.
function formToNowhere( html: string ): string {
	const nowhere = [ ...html.matchAll( /<form\b[^>]*>/gi ) ].some( ( [ tag ] ) => {
		const action = tag.match( /\saction\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i );
		return ! action || /^#?$/.test( ( action[ 1 ] ?? action[ 2 ] ?? action[ 3 ] ).trim() );
	} );
	return nowhere
		? ' Its form submits to the page it is on (its action is "#", empty or missing), where WordPress reads none of its fields, so what a visitor enters is lost.'
		: '';
}

// The markup a preferred plugin's block replaces, with that block.
function replacingPlugin( html: string ): PreferredPlugin | undefined {
	return PREFERRED_PLUGINS.find( ( plugin ) => plugin.replaces?.pattern.test( html ) );
}

interface HtmlBlockPolicyResult {
	blockNumber: number;
	line: number;
	content: string;
	issues: string[];
	/** The block a plugin registers for it, when one is recommended. */
	block?: string;
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

	const preferred = replacingPlugin( html );
	if ( preferred?.replaces ) {
		const { markup, block, does } = preferred.replaces;
		return [
			`core/html contains ${ markup } markup.${ formToNowhere( html ) } ${
				preferred.plugin
			}'s block (${ block }) stays editable in the block editor and does what the markup does${
				does ? `: it ${ does }` : ''
			}; the plugin-recommendations skill names the plugin for each feature.`,
		];
	}

	return [
		'core/html contains markup that should use editable blocks. Keep core/html only for inline SVG, interaction markup with no block equivalent (marquee, cursor), or a single script block.',
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

		const html = blockContent.replace( BLOCK_COMMENT_PATTERN, '' );
		const block = replacingPlugin( html )?.replaces?.block;
		invalidHtmlBlocks.push( {
			blockNumber: totalHtmlBlocks,
			line: content.slice( 0, match.index ?? 0 ).split( '\n' ).length,
			content: blockContent.trim(),
			issues,
			...( block && { block } ),
		} );
	}

	return {
		totalHtmlBlocks,
		invalidHtmlBlocks,
	};
}
