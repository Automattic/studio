import { __, _n, sprintf } from '@wordpress/i18n';
import { theme } from 'cli/ai/theme';

const COLLAPSE_THRESHOLD_LINES = 5;
const DEFAULT_DETAIL_MAX_LENGTH = 4000;

export function formatToolOutputLines( lines: string[] ): string {
	return lines
		.map(
			( line, index ) => `${ index === 0 ? '   ' + theme.fg( 'muted', '⎿ ' ) : '     ' }${ line }`
		)
		.join( '\n' );
}

export interface ToolResultRenderContext {
	input: Record< string, unknown >;
	text: string;
	isError: boolean;
	details?: unknown;
}

// Renders a tool result's formatted transcript block for the given expansion
// state, or returns null to defer to the generic fallback.
export type ToolResultRenderer = (
	context: ToolResultRenderContext,
	expanded: boolean
) => string | null;

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

function stripHtmlTags( input: string ): string {
	let previous: string;
	let result = input;
	do {
		previous = result;
		result = result.replace( /<[^>]*>/g, '' );
	} while ( result !== previous );
	return result;
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
		return typeof rendered === 'string' ? stripHtmlTags( rendered ) : '';
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

function getCountSummary( count: number, noun: string ): string {
	return sprintf(
		/* translators: 1: number of items, 2: item type */
		_n( 'Returned %1$d %2$s', 'Returned %1$d %2$s', count ),
		count,
		noun
	);
}

// Head-biased collapsed preview: first lines plus a "%d more" hint.
function headPreview( lines: string[], expanded: boolean ): string {
	if ( expanded || lines.length <= COLLAPSE_THRESHOLD_LINES ) {
		return formatToolOutputLines( lines );
	}
	return (
		formatToolOutputLines( lines.slice( 0, COLLAPSE_THRESHOLD_LINES ) ) +
		'\n     ' +
		theme.fg(
			'muted',
			sprintf(
				/* translators: %d: number of hidden lines */
				__( '... %d more lines · ctrl+o to expand' ),
				lines.length - COLLAPSE_THRESHOLD_LINES
			)
		)
	);
}

function summaryWithDetail(
	summaryLines: string[],
	detailText: string,
	detailLabel: string,
	expanded: boolean,
	options: { isError?: boolean; maxLength?: number } = {}
): string {
	const styledSummary = summaryLines.map( ( line ) =>
		options.isError ? theme.fg( 'error', line ) : theme.fg( 'muted', line )
	);
	if ( ! expanded ) {
		return formatToolOutputLines( [ ...styledSummary, theme.fg( 'muted', detailLabel ) ] );
	}
	const maxLength = options.maxLength ?? DEFAULT_DETAIL_MAX_LENGTH;
	const truncated =
		detailText.length > maxLength
			? detailText.slice( 0, maxLength ) + '\n' + __( '... output truncated' )
			: detailText;
	return formatToolOutputLines( [
		...styledSummary,
		...truncated.split( '\n' ).map( ( line ) => theme.fg( 'muted', line ) ),
	] );
}

export function renderGenericToolResult(
	text: string,
	expanded: boolean,
	maxLength = 500
): string {
	const truncated = text.length > maxLength ? text.slice( 0, maxLength ) + '…' : text;
	return headPreview(
		truncated.split( '\n' ).map( ( line ) => theme.fg( 'muted', line ) ),
		expanded
	);
}

const renderSkillResult: ToolResultRenderer = ( { text }, expanded ) => {
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

	return summaryWithDetail(
		summaryLines,
		text,
		__( 'Full skill body hidden · ctrl+o to expand' ),
		expanded,
		{ maxLength: 12000 }
	);
};

function getWpcomSummaryLines( input: Record< string, unknown >, text: string ): string[] {
	const parsed = parseJson( text );
	const method = typeof input.method === 'string' ? input.method : '';
	const path = typeof input.path === 'string' ? input.path : '';
	const target = [ method, path ].filter( Boolean ).join( ' ' );
	const withTarget = ( summary: string ) =>
		target ? sprintf( __( '%1$s: %2$s' ), target, summary ) : summary;

	if ( Array.isArray( parsed ) ) {
		return [ withTarget( getCountSummary( parsed.length, __( 'items' ) ) ) ];
	}

	if ( parsed && typeof parsed === 'object' ) {
		const record = parsed as Record< string, unknown >;
		const arrayEntry = Object.entries( record ).find( ( [ , value ] ) => Array.isArray( value ) );
		if ( arrayEntry ) {
			const [ key, value ] = arrayEntry as [ string, unknown[] ];
			const count = typeof record.found === 'number' ? record.found : value.length;
			return [ withTarget( getCountSummary( count, key ) ) ];
		}

		const resourceName = getResourceName( record );
		if ( resourceName ) {
			return [
				target
					? sprintf( __( '%1$s: returned %2$s' ), target, resourceName )
					: sprintf( __( 'Returned %s' ), resourceName ),
			];
		}

		const keys = Object.keys( record ).slice( 0, 4 );
		return [
			target ? sprintf( __( '%1$s: returned response' ), target ) : __( 'Returned response' ),
			keys.length > 0 ? sprintf( __( 'Fields: %s' ), keys.join( ', ' ) ) : '',
		].filter( Boolean );
	}

	return [ firstNonEmptyLine( text ) || __( 'Request completed' ) ];
}

const renderWpcomResult: ToolResultRenderer = ( { input, text, isError }, expanded ) => {
	if ( ! text ) {
		return null;
	}
	if ( isError ) {
		return summaryWithDetail(
			[ firstNonEmptyLine( text ) || __( 'Request failed' ) ],
			text,
			__( 'Full API error hidden · ctrl+o to expand' ),
			expanded,
			{ isError: true }
		);
	}
	return summaryWithDetail(
		getWpcomSummaryLines( input, text ),
		text,
		__( 'Full API response hidden · ctrl+o to expand' ),
		expanded
	);
};

const renderSiteCreateResult: ToolResultRenderer = ( { text, isError }, expanded ) => {
	if ( ! text ) {
		return null;
	}
	if ( isError ) {
		return summaryWithDetail(
			[ firstNonEmptyLine( text ) || __( 'Site creation failed' ) ],
			text,
			__( 'Full site error hidden · ctrl+o to expand' ),
			expanded,
			{ isError: true }
		);
	}

	const parsed = parseJson( text );
	if ( ! parsed || typeof parsed !== 'object' || Array.isArray( parsed ) ) {
		return null;
	}

	const record = parsed as Record< string, unknown >;
	const name = getDisplayValue( record.name );
	const url = getDisplayValue( record.url );
	return summaryWithDetail(
		[ name ? sprintf( __( 'Created site %s' ), name ) : __( 'Created site' ), url ].filter(
			Boolean
		),
		text,
		__( 'Full site details hidden · ctrl+o to expand' ),
		expanded
	);
};

export const toolResultRenderers: Record< string, ToolResultRenderer > = {
	site_create: renderSiteCreateResult,
	Skill: renderSkillResult,
	wpcom_request: renderWpcomResult,
	validate_blocks: ( { text }, expanded ) =>
		text ? renderGenericToolResult( text, expanded, 2000 ) : null,
};
