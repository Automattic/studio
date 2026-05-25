import { __, _n, sprintf } from '@wordpress/i18n';

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
		case 'wpcom_request': {
			const method = typeof input.method === 'string' ? input.method : '';
			const path = typeof input.path === 'string' ? input.path : '';
			return [ method, path ].filter( Boolean ).join( ' ' );
		}
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
			if ( typeof input.name === 'string' ) {
				return input.name;
			}
			return typeof input.skill === 'string' ? input.skill : '';
		case 'Grep':
		case 'Glob':
			return typeof input.pattern === 'string' ? input.pattern : '';
		case 'Ls':
			return typeof input.path === 'string' ? input.path.split( '/' ).slice( -2 ).join( '/' ) : '';
		default:
			return '';
	}
}

export interface NormalizedToolResult {
	text: string;
	isError: boolean;
}

export interface ToolResultPreview {
	summaryLines: string[];
	detailText?: string;
	detailLabel?: string;
	detailMaxLength?: number;
}

function countLines( text: string ): number {
	if ( text.length === 0 ) {
		return 0;
	}
	const normalized = text.endsWith( '\n' ) ? text.slice( 0, -1 ) : text;
	return normalized.split( '\n' ).length;
}

function firstNonEmptyLine( text: string ): string {
	return (
		text
			.split( '\n' )
			.map( ( line ) => line.trim() )
			.find( Boolean ) ?? ''
	);
}

function parseJson( text: string ): unknown {
	try {
		return JSON.parse( text );
	} catch {
		return null;
	}
}

function getSkillPreview( text: string ): ToolResultPreview | null {
	const title = text.match( /^#\s+(.+)$/m )?.[ 1 ]?.trim();
	if ( ! title ) {
		return null;
	}

	const sections = Array.from( text.matchAll( /^##\s+(.+)$/gm ) )
		.map( ( match ) => match[ 1 ].trim() )
		.filter( Boolean );
	const visibleSections = sections.slice( 0, 4 );
	const sectionSuffix = sections.length > visibleSections.length ? ', ...' : '';
	const summaryLines: string[] = [ sprintf( __( 'Loaded %s' ), title ) ];

	if ( visibleSections.length > 0 ) {
		summaryLines.push(
			sprintf( __( 'Sections: %s' ), visibleSections.join( ', ' ) + sectionSuffix )
		);
	}

	return {
		summaryLines,
		detailText: text,
		detailLabel: __( 'Full skill body hidden · ctrl+o to expand' ),
		detailMaxLength: 12000,
	};
}

function getDisplayValue( value: unknown ): string {
	if ( typeof value === 'string' ) {
		return value;
	}
	if ( typeof value === 'number' ) {
		return String( value );
	}
	if ( value && typeof value === 'object' && 'rendered' in value ) {
		const rendered = ( value as { rendered?: unknown } ).rendered;
		return typeof rendered === 'string' ? rendered.replace( /<[^>]*>/g, '' ) : '';
	}
	return '';
}

function getResourceName( value: unknown ): string {
	if ( ! value || typeof value !== 'object' || Array.isArray( value ) ) {
		return '';
	}
	const record = value as Record< string, unknown >;
	return (
		getDisplayValue( record.title ) ||
		getDisplayValue( record.name ) ||
		getDisplayValue( record.slug ) ||
		getDisplayValue( record.ID ) ||
		getDisplayValue( record.id )
	);
}

function getArraySummary( items: unknown[], noun: string ): string {
	return sprintf(
		/* translators: 1: number of items, 2: item type */
		_n( 'Returned %1$d %2$s', 'Returned %1$d %2$s', items.length ),
		items.length,
		noun
	);
}

function getWpcomResultPreview(
	input: Record< string, unknown > | undefined,
	text: string,
	isError: boolean
): ToolResultPreview {
	if ( isError ) {
		return {
			summaryLines: [ firstNonEmptyLine( text ) || __( 'Request failed' ) ],
			detailText: text,
			detailLabel: __( 'Full API error hidden · ctrl+o to expand' ),
		};
	}

	const parsed = parseJson( text );
	const method = typeof input?.method === 'string' ? input.method : '';
	const path = typeof input?.path === 'string' ? input.path : '';
	const target = [ method, path ].filter( Boolean ).join( ' ' );

	if ( Array.isArray( parsed ) ) {
		const summary = getArraySummary( parsed, __( 'items' ) );
		return {
			summaryLines: [ target ? sprintf( __( '%1$s: %2$s' ), target, summary ) : summary ],
			detailText: text,
			detailLabel: __( 'Full API response hidden · ctrl+o to expand' ),
		};
	}

	if ( parsed && typeof parsed === 'object' ) {
		const record = parsed as Record< string, unknown >;
		const arrayEntry = Object.entries( record ).find( ( [ , value ] ) => Array.isArray( value ) );
		const found = typeof record.found === 'number' ? record.found : null;
		const resourceName = getResourceName( record );

		if ( arrayEntry ) {
			const [ key, value ] = arrayEntry as [ string, unknown[] ];
			const count = found ?? value.length;
			const summary = sprintf(
				/* translators: 1: number of resources, 2: resource key */
				_n( 'Returned %1$d %2$s', 'Returned %1$d %2$s', count ),
				count,
				key
			);
			return {
				summaryLines: [ target ? sprintf( __( '%1$s: %2$s' ), target, summary ) : summary ],
				detailText: text,
				detailLabel: __( 'Full API response hidden · ctrl+o to expand' ),
			};
		}

		if ( resourceName ) {
			return {
				summaryLines: [
					target
						? sprintf( __( '%1$s: returned %2$s' ), target, resourceName )
						: sprintf( __( 'Returned %s' ), resourceName ),
				],
				detailText: text,
				detailLabel: __( 'Full API response hidden · ctrl+o to expand' ),
			};
		}

		const keys = Object.keys( record ).slice( 0, 4 );
		return {
			summaryLines: [
				target ? sprintf( __( '%1$s: returned response' ), target ) : __( 'Returned response' ),
				keys.length > 0 ? sprintf( __( 'Fields: %s' ), keys.join( ', ' ) ) : '',
			].filter( Boolean ),
			detailText: text,
			detailLabel: __( 'Full API response hidden · ctrl+o to expand' ),
		};
	}

	return {
		summaryLines: [ firstNonEmptyLine( text ) || __( 'Request completed' ) ],
		detailText: text,
		detailLabel: __( 'Full API response hidden · ctrl+o to expand' ),
	};
}

function getFileToolPreview( name: string, text: string, isError: boolean ): ToolResultPreview {
	if ( isError ) {
		return {
			summaryLines: [ firstNonEmptyLine( text ) || __( 'File operation failed' ) ],
			detailText: text,
			detailLabel: __( 'Full file error hidden · ctrl+o to expand' ),
		};
	}

	if ( name === 'Read' ) {
		const lines = countLines( text );
		return {
			summaryLines: [ sprintf( _n( 'Read %d line', 'Read %d lines', lines ), lines ) ],
			detailText: text,
			detailLabel: __( 'File contents hidden · ctrl+o to expand' ),
		};
	}

	return {
		summaryLines: [ name === 'Write' ? __( 'File written' ) : __( 'File edited' ) ],
		detailText: text,
		detailLabel: __( 'Full tool output hidden · ctrl+o to expand' ),
	};
}

function getBashPreview( text: string, isError: boolean ): ToolResultPreview {
	const firstLine = firstNonEmptyLine( text );
	return {
		summaryLines: [
			isError
				? firstLine || __( 'Command failed' )
				: firstLine
				? sprintf( __( 'Command completed: %s' ), firstLine )
				: __( 'Command completed' ),
		],
		detailText: text,
		detailLabel: isError
			? __( 'Full command output hidden · ctrl+o to expand' )
			: __( 'Command output hidden · ctrl+o to expand' ),
	};
}

export function getToolResultPreview(
	name: string | undefined,
	input: Record< string, unknown > | undefined,
	text: string,
	isError = false
): ToolResultPreview | null {
	if ( ! name || ! text ) {
		return null;
	}

	switch ( name ) {
		case 'Skill':
			return getSkillPreview( text );
		case 'wpcom_request':
			return getWpcomResultPreview( input, text, isError );
		case 'Read':
		case 'Write':
		case 'Edit':
			return getFileToolPreview( name, text, isError );
		case 'Bash':
			return getBashPreview( text, isError );
		default:
			return null;
	}
}
