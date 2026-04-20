import { __ } from '@wordpress/i18n';

/**
 * Human-facing display name for a tool, localized.
 * Falls back to the raw tool name (e.g. an unknown MCP tool) so the UI/CLI
 * always has something to show.
 */
export function getToolDisplayName( name: string ): string {
	const displayNames: Record< string, string > = {
		mcp__studio__site_create: __( 'Create site' ),
		mcp__studio__site_list: __( 'List sites' ),
		mcp__studio__site_info: __( 'Get site info' ),
		mcp__studio__site_start: __( 'Start site' ),
		mcp__studio__site_stop: __( 'Stop site' ),
		mcp__studio__site_delete: __( 'Delete site' ),
		mcp__studio__preview_create: __( 'Create preview' ),
		mcp__studio__preview_list: __( 'List previews' ),
		mcp__studio__preview_update: __( 'Update preview' ),
		mcp__studio__preview_delete: __( 'Delete preview' ),
		mcp__studio__wp_cli: __( 'Run WP-CLI' ),
		mcp__studio__validate_blocks: __( 'Validate blocks' ),
		mcp__studio__take_screenshot: __( 'Take screenshot' ),
		Read: __( 'Read' ),
		Write: __( 'Write' ),
		Edit: __( 'Edit' ),
		Bash: __( 'Run' ),
		Glob: __( 'Search' ),
		Grep: __( 'Search' ),
		Skill: __( 'Load skill' ),
		Task: __( 'Run task' ),
		TodoWrite: __( 'Update todo list' ),
	};
	return displayNames[ name ] ?? name;
}

const BASH_DETAIL_MAX_LENGTH = 60;

/**
 * Short detail string extracted from a tool's input, suitable for display
 * next to the tool name (e.g. a filename for Read/Write/Edit, a pattern for
 * Grep/Glob, a truncated command for Bash). Returns `''` when no useful
 * detail can be derived.
 */
export function getToolDetail( name: string, input?: Record< string, unknown > ): string {
	if ( ! input ) {
		return '';
	}
	switch ( name ) {
		case 'mcp__studio__site_create':
			return typeof input.name === 'string' ? input.name : '';
		case 'mcp__studio__site_info':
		case 'mcp__studio__site_start':
		case 'mcp__studio__site_stop':
		case 'mcp__studio__site_delete':
		case 'mcp__studio__preview_create':
		case 'mcp__studio__preview_list':
			return typeof input.nameOrPath === 'string' ? input.nameOrPath : '';
		case 'mcp__studio__preview_update':
		case 'mcp__studio__preview_delete':
			return typeof input.host === 'string' ? input.host : '';
		case 'mcp__studio__wp_cli':
			return typeof input.command === 'string' ? `wp ${ input.command }` : '';
		case 'mcp__studio__validate_blocks':
			if ( typeof input.filePath === 'string' ) {
				return input.filePath.split( '/' ).slice( -2 ).join( '/' );
			}
			return __( 'inline content' );
		case 'mcp__studio__take_screenshot':
			return typeof input.url === 'string' ? input.url : '';
		case 'Read':
		case 'Write':
		case 'Edit': {
			const filePath = input.file_path ?? input.path;
			if ( typeof filePath === 'string' ) {
				return filePath.split( '/' ).slice( -2 ).join( '/' );
			}
			return '';
		}
		case 'Bash':
			if ( typeof input.command !== 'string' ) {
				return '';
			}
			return input.command.length > BASH_DETAIL_MAX_LENGTH
				? input.command.slice( 0, BASH_DETAIL_MAX_LENGTH - 3 ) + '…'
				: input.command;
		case 'Skill':
			return typeof input.skill === 'string' ? input.skill : '';
		case 'Grep':
		case 'Glob':
			return typeof input.pattern === 'string' ? input.pattern : '';
		default:
			return '';
	}
}
