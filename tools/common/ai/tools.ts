import { __ } from '@wordpress/i18n';

/**
 * Human-facing display name for a tool, localized.
 * Falls back to the raw tool name (e.g. an unknown tool) so the UI/CLI
 * always has something to show.
 */
export function getToolDisplayName( name: string ): string {
	const displayNames: Record< string, string > = {
		site_create: __( 'Create site' ),
		site_list: __( 'List sites' ),
		site_info: __( 'Get site info' ),
		site_start: __( 'Start site' ),
		site_stop: __( 'Stop site' ),
		site_delete: __( 'Delete site' ),
		site_push: __( 'Push site' ),
		site_pull: __( 'Pull site' ),
		site_import: __( 'Import site' ),
		site_export: __( 'Export site' ),
		preview_create: __( 'Create preview' ),
		preview_list: __( 'List previews' ),
		preview_update: __( 'Update preview' ),
		preview_delete: __( 'Delete preview' ),
		wp_cli: __( 'Run WP-CLI' ),
		scaffold_theme: __( 'Scaffold theme' ),
		validate_blocks: __( 'Validate blocks' ),
		take_screenshot: __( 'Take screenshot' ),
		share_screenshot: __( 'Share screenshot' ),
		preview_navigate: __( 'Navigate preview' ),
		preview_reload: __( 'Reload preview' ),
		need_for_speed: __( 'Audit performance' ),
		rank_me_up: __( 'Audit SEO' ),
		install_taxonomy_scripts: __( 'Install taxonomy scripts' ),
		wpcom_request: __( 'WordPress.com API' ),
		AskUserQuestion: __( 'Ask user' ),
		Read: __( 'Read' ),
		Write: __( 'Write' ),
		Edit: __( 'Edit' ),
		Bash: __( 'Run' ),
		Glob: __( 'Search' ),
		Grep: __( 'Search' ),
		Ls: __( 'List' ),
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
		case 'site_create':
			return typeof input.name === 'string' ? input.name : '';
		case 'site_info':
		case 'site_start':
		case 'site_stop':
		case 'site_delete':
		case 'site_push':
		case 'site_pull':
		case 'site_import':
		case 'site_export':
		case 'preview_create':
		case 'preview_list':
			return typeof input.nameOrPath === 'string' ? input.nameOrPath : '';
		case 'preview_update':
		case 'preview_delete':
			return typeof input.host === 'string' ? input.host : '';
		case 'wp_cli':
			return typeof input.command === 'string' ? `wp ${ input.command }` : '';
		case 'scaffold_theme':
			return typeof input.name === 'string' ? input.name : '';
		case 'validate_blocks':
			if ( typeof input.filePath === 'string' ) {
				return input.filePath.split( '/' ).slice( -2 ).join( '/' );
			}
			return __( 'inline content' );
		case 'take_screenshot':
		case 'share_screenshot':
			return typeof input.url === 'string' ? input.url : '';
		case 'preview_navigate':
			return typeof input.path === 'string' ? input.path : '';
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

export interface NormalizedToolResult {
	text: string;
	isError: boolean;
}
