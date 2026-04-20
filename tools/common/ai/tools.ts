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

export interface NormalizedToolResult {
	text: string;
	isError: boolean;
}

function normalizeResultContent( content: unknown ): string {
	if ( typeof content === 'string' ) {
		return content;
	}
	if ( Array.isArray( content ) ) {
		return content
			.map( ( block ) => {
				if ( block && typeof block === 'object' && 'text' in block ) {
					const text = ( block as { text?: unknown } ).text;
					return typeof text === 'string' ? text : '';
				}
				return '';
			} )
			.filter( Boolean )
			.join( '\n' );
	}
	if ( content === undefined || content === null ) {
		return '';
	}
	return String( content );
}

/**
 * Normalize a tool result payload — either an Anthropic `tool_result` block
 * (`{ content, is_error }`) or one of Studio's MCP-tool result shapes
 * (`{ stdout, stderr, is_error }`) — into a single `{ text, isError }` pair.
 * Returns `null` for unrecognized shapes.
 */
export function extractToolResult( result: unknown ): NormalizedToolResult | null {
	if ( ! result || typeof result !== 'object' ) {
		return null;
	}
	const obj = result as Record< string, unknown >;

	if ( 'content' in obj || 'isError' in obj || 'is_error' in obj ) {
		return {
			text: normalizeResultContent( obj.content ),
			isError: obj.isError === true || obj.is_error === true,
		};
	}

	if ( 'stdout' in obj || 'stderr' in obj || 'noOutputExpected' in obj ) {
		const stdout = typeof obj.stdout === 'string' ? obj.stdout : '';
		const stderr = typeof obj.stderr === 'string' ? obj.stderr : '';
		const parts = [ stdout, stderr ? `stderr: ${ stderr }` : '' ].filter( Boolean );
		return {
			text: parts.join( '\n' ),
			isError: obj.is_error === true,
		};
	}

	return null;
}

/**
 * Pull all `tool_result` content blocks out of a `user`-type SDK message and
 * return them keyed by `tool_use_id`, normalized via `extractToolResult`.
 * Returns an empty map when the message isn't a user tool-result carrier.
 */
export function extractToolResultsFromUserMessage(
	message: unknown
): Map< string, NormalizedToolResult > {
	const results = new Map< string, NormalizedToolResult >();
	const msg = message as { type?: string; message?: { content?: unknown } } | null;
	if ( ! msg || msg.type !== 'user' ) {
		return results;
	}
	const content = msg.message?.content;
	if ( ! Array.isArray( content ) ) {
		return results;
	}
	for ( const block of content ) {
		if ( ! block || typeof block !== 'object' ) {
			continue;
		}
		const typed = block as {
			type?: unknown;
			tool_use_id?: unknown;
		};
		if ( typed.type !== 'tool_result' || typeof typed.tool_use_id !== 'string' ) {
			continue;
		}
		const normalized = extractToolResult( block );
		if ( normalized ) {
			results.set( typed.tool_use_id, normalized );
		}
	}
	return results;
}
