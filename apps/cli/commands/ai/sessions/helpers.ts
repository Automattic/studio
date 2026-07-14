import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { select } from '@inquirer/prompts';
import { listAiSessions } from '@studio/common/ai/sessions/store';
import chalk from '@studio/common/lib/chalk';
import { getSessionsDirectory } from '@studio/common/lib/well-known-paths';
import { __ } from '@wordpress/i18n';
import type { AiSessionSummary } from '@studio/common/ai/sessions/types';

function formatSessionTimestamp( timestamp: string ): string {
	const parsed = Date.parse( timestamp );
	if ( Number.isNaN( parsed ) ) {
		return timestamp;
	}

	return new Date( parsed ).toISOString().replace( '.000Z', 'Z' ).replace( 'T', ' ' );
}

function getRelativeTime( timestamp: string ): string {
	const targetMs = Date.parse( timestamp );
	if ( Number.isNaN( targetMs ) ) {
		return formatSessionTimestamp( timestamp );
	}

	const diffMs = targetMs - Date.now();
	const absDiffMs = Math.abs( diffMs );
	const rtf = new Intl.RelativeTimeFormat( undefined, { numeric: 'auto' } );
	const units = [
		{ unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
		{ unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
		{ unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
		{ unit: 'day', ms: 24 * 60 * 60 * 1000 },
		{ unit: 'hour', ms: 60 * 60 * 1000 },
		{ unit: 'minute', ms: 60 * 1000 },
		{ unit: 'second', ms: 1000 },
	] as const;

	for ( const { unit, ms } of units ) {
		if ( absDiffMs >= ms || unit === 'second' ) {
			const value = Math.round( diffMs / ms );
			return rtf.format( value, unit );
		}
	}

	return formatSessionTimestamp( timestamp );
}

function toSingleLine( text: string ): string {
	return text.replace( /\s+/g, ' ' ).trim();
}

function truncateWithEllipsis( text: string, maxLength: number ): string {
	if ( maxLength <= 0 ) {
		return '';
	}
	if ( maxLength === 1 ) {
		return '…';
	}

	return truncateToWidth( text, maxLength, '…' );
}

function padEndVisible( text: string, width: number ): string {
	return `${ text }${ ' '.repeat( Math.max( 0, width - visibleWidth( text ) ) ) }`;
}

function styleSessionId( id: string ): string {
	return chalk.bold( id.slice( 0, 8 ) ) + chalk.dim( id.slice( 8 ) );
}

function formatSessionCompactLine(
	session: AiSessionSummary,
	terminalWidth: number,
	layout: { idWidth: number; relativeWidth: number }
): string {
	const relative = getRelativeTime( session.updatedAt );
	const prompt = toSingleLine( session.firstPrompt ?? __( '(No prompt yet)' ) );
	const separator = chalk.dim( ' • ' );
	const idText = padEndVisible( session.id, layout.idWidth );
	const relativeText = padEndVisible( relative, layout.relativeWidth );
	const hasStatusGlyph = session.endReason === 'error' || session.endReason === 'stopped';
	const statusPlainWidth = hasStatusGlyph ? 2 : 0;
	const siteLabelPlain = session.selectedSiteName ? `✻ ${ session.selectedSiteName }` : '';
	const maxSiteLabelLength = Math.max( 8, Math.floor( terminalWidth * 0.25 ) );
	const siteLabel = truncateWithEllipsis( siteLabelPlain, maxSiteLabelLength );
	const suffixWidth = siteLabel ? visibleWidth( siteLabel ) : 0;
	const gapWidth = siteLabel ? 2 : 0;
	const prefixPlain = `${ idText } • ${ relativeText } • `;
	const maxPromptLength = Math.max(
		1,
		terminalWidth - visibleWidth( prefixPlain ) - statusPlainWidth - gapWidth - suffixWidth - 1
	);
	const abstract = truncateWithEllipsis( prompt, maxPromptLength );
	const promptStyled = session.firstPrompt ? chalk.white( abstract ) : chalk.dim( abstract );

	const statusGlyph =
		session.endReason === 'error'
			? chalk.red( '✕ ' )
			: session.endReason === 'stopped'
			? chalk.gray( '◌ ' )
			: '';
	const leftPlain = `${ idText } • ${ relativeText } • ${ statusGlyph ? 'x ' : '' }${ abstract }`;
	const renderedLeft = `${ styleSessionId( session.id ) }${ ' '.repeat(
		Math.max( 0, layout.idWidth - visibleWidth( session.id ) )
	) }${ separator }${ chalk.cyan( relative ) }${ ' '.repeat(
		Math.max( 0, layout.relativeWidth - visibleWidth( relative ) )
	) }${ separator }${ statusGlyph }${ promptStyled }`;
	if ( ! siteLabel ) {
		return renderedLeft;
	}

	const padding = Math.max(
		2,
		terminalWidth - visibleWidth( leftPlain ) - visibleWidth( siteLabel ) - 1
	);
	return `${ renderedLeft }${ ' '.repeat( padding ) }${ chalk.hex( '#8839ef' )( siteLabel ) }`;
}

export function displaySessionsCompact( sessions: AiSessionSummary[] ): void {
	const terminalWidth = Math.max( process.stdout.columns ?? 100, 60 );
	const relativeTimes = sessions.map( ( session ) => getRelativeTime( session.updatedAt ) );
	const layout = {
		idWidth: Math.max( ...sessions.map( ( session ) => visibleWidth( session.id ) ) ),
		relativeWidth: Math.max( ...relativeTimes.map( ( value ) => visibleWidth( value ) ) ),
	};

	console.log(
		chalk.bold( __( 'Code Sessions' ) ) +
			chalk.dim( ` (${ sessions.length })` ) +
			chalk.dim( ` · ${ __( 'Most recent first' ) }` )
	);

	for ( const session of sessions ) {
		console.log( formatSessionCompactLine( session, terminalWidth, layout ) );
	}
}

async function pickSessionInteractively(
	sessions: AiSessionSummary[],
	message: string
): Promise< AiSessionSummary | undefined > {
	const interactiveWidth = Math.max( ( process.stdout.columns ?? 100 ) - 4, 56 );
	const abortController = new AbortController();
	const handleEscKey = ( chunk: Buffer | string ) => {
		const bytes = Buffer.isBuffer( chunk ) ? chunk : Buffer.from( chunk );
		if ( bytes.length === 1 && bytes[ 0 ] === 0x1b ) {
			abortController.abort();
		}
	};

	if ( process.stdin.isTTY ) {
		process.stdin.on( 'data', handleEscKey );
	}

	try {
		const selectedSessionId = await select(
			{
				message,
				choices: sessions.map( ( session ) => ( {
					name: formatSessionCompactLine( session, interactiveWidth, {
						idWidth: Math.max( ...sessions.map( ( s ) => visibleWidth( s.id ) ) ),
						relativeWidth: Math.max(
							...sessions.map( ( s ) => visibleWidth( getRelativeTime( s.updatedAt ) ) )
						),
					} ),
					value: session.id,
				} ) ),
				pageSize: Math.min( 12, sessions.length ),
				loop: false,
				theme: {
					style: {
						keysHelpTip: () =>
							chalk.dim(
								[ __( '↑↓ navigate' ), __( '⏎ select' ), __( 'esc cancel' ) ].join( ' · ' )
							),
					},
				},
			},
			{
				signal: abortController.signal,
			}
		);

		return sessions.find( ( session ) => session.id === selectedSessionId );
	} catch ( error ) {
		if (
			error instanceof Error &&
			( error.name === 'AbortPromptError' || error.name === 'ExitPromptError' )
		) {
			return undefined;
		}

		throw error;
	} finally {
		if ( process.stdin.isTTY ) {
			process.stdin.off( 'data', handleEscKey );
		}
	}
}

export async function chooseSessionForAction(
	actionLabel: string,
	noSessionsMessage: string
): Promise< AiSessionSummary | undefined > {
	const sessions = await listAiSessions( getSessionsDirectory() );
	if ( sessions.length === 0 ) {
		console.log( noSessionsMessage );
		return undefined;
	}

	return pickSessionInteractively( sessions, actionLabel );
}
