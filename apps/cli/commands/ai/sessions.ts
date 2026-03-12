import { select } from '@inquirer/prompts';
import { __ } from '@wordpress/i18n';
import chalk from 'chalk';
import {
	deleteAiSession,
	listAiSessions,
	loadAiSession,
	type AiSessionSummary,
} from 'cli/ai/sessions';
import { runCommand as runAiCommand } from 'cli/commands/ai';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< string >();

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
	if ( text.length <= maxLength ) {
		return text;
	}

	if ( maxLength <= 1 ) {
		return '…';
	}

	return text.slice( 0, maxLength - 1 ) + '…';
}

function visibleWidth( text: string ): number {
	return Array.from( text ).length;
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

function displaySessionsCompact( sessions: AiSessionSummary[] ): void {
	const terminalWidth = Math.max( process.stdout.columns ?? 100, 60 );
	const relativeTimes = sessions.map( ( session ) => getRelativeTime( session.updatedAt ) );
	const layout = {
		idWidth: Math.max( ...sessions.map( ( session ) => visibleWidth( session.id ) ) ),
		relativeWidth: Math.max( ...relativeTimes.map( ( value ) => visibleWidth( value ) ) ),
	};

	console.log(
		chalk.bold( __( 'AI Sessions' ) ) +
			chalk.dim( ` (${ sessions.length })` ) +
			chalk.dim( ` · ${ __( 'Most recent first' ) }` )
	);

	for ( const session of sessions ) {
		console.log( formatSessionCompactLine( session, terminalWidth, layout ) );
	}
}

async function runListSessionsCommand( format: 'compact' | 'json' ): Promise< void > {
	const sessions = await listAiSessions();

	if ( sessions.length === 0 ) {
		console.log( __( 'No AI sessions found' ) );
		return;
	}

	if ( format === 'json' ) {
		console.log( JSON.stringify( sessions, null, 2 ) );
		return;
	}

	displaySessionsCompact( sessions );
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
						keysHelpTip: () => chalk.dim( '↑↓ navigate · ⏎ select · esc cancel' ),
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

async function chooseSessionForAction(
	actionLabel: string,
	noSessionsMessage: string
): Promise< AiSessionSummary | undefined > {
	const sessions = await listAiSessions();
	if ( sessions.length === 0 ) {
		console.log( noSessionsMessage );
		return undefined;
	}

	return pickSessionInteractively( sessions, actionLabel );
}

async function runResumeSessionCommand(
	sessionIdOrPrefix?: string,
	options: { noSessionPersistence?: boolean } = {}
): Promise< void > {
	let resolvedSessionIdOrPrefix = sessionIdOrPrefix?.trim();

	if ( ! resolvedSessionIdOrPrefix ) {
		const selectedSession = await chooseSessionForAction(
			__( 'Select a session to resume:' ),
			__( 'No AI sessions found' )
		);
		if ( ! selectedSession ) {
			return;
		}

		resolvedSessionIdOrPrefix = selectedSession.id;
	}

	if ( resolvedSessionIdOrPrefix.toLowerCase() === 'latest' ) {
		const sessions = await listAiSessions();
		if ( sessions.length === 0 ) {
			throw new Error( __( 'No AI sessions found' ) );
		}

		resolvedSessionIdOrPrefix = sessions[ 0 ].id;
	}

	const session = await loadAiSession( resolvedSessionIdOrPrefix );
	await runAiCommand( {
		resumeSession: session,
		noSessionPersistence: options.noSessionPersistence === true,
	} );
}

async function runDeleteSessionCommand( sessionIdOrPrefix?: string ): Promise< void > {
	let resolvedSessionIdOrPrefix = sessionIdOrPrefix?.trim();

	if ( ! resolvedSessionIdOrPrefix ) {
		const selectedSession = await chooseSessionForAction(
			__( 'Select a session to delete:' ),
			__( 'No AI sessions found' )
		);
		if ( ! selectedSession ) {
			return;
		}

		resolvedSessionIdOrPrefix = selectedSession.id;
	}

	if ( resolvedSessionIdOrPrefix.toLowerCase() === 'latest' ) {
		const sessions = await listAiSessions();
		if ( sessions.length === 0 ) {
			throw new Error( __( 'No AI sessions found' ) );
		}

		resolvedSessionIdOrPrefix = sessions[ 0 ].id;
	}

	const deletedSession = await deleteAiSession( resolvedSessionIdOrPrefix );
	console.log( `${ __( 'Deleted AI session' ) }: ${ deletedSession.id }` );
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs
		.command( {
			command: 'list',
			describe: __( 'List AI sessions' ),
			builder: ( listYargs ) => {
				return listYargs.option( 'format', {
					type: 'string',
					choices: [ 'compact', 'json' ] as const,
					default: 'compact' as const,
					description: __( 'Output format' ),
				} );
			},
			handler: async ( argv ) => {
				try {
					await runListSessionsCommand( argv.format as 'compact' | 'json' );
				} catch ( error ) {
					if ( error instanceof LoggerError ) {
						logger.reportError( error );
					} else {
						logger.reportError( new LoggerError( __( 'Failed to list AI sessions' ), error ) );
					}
				}
			},
		} )
		.command( {
			command: 'resume [id]',
			describe: __( 'Resume an AI session (id, prefix, "latest", or picker)' ),
			builder: ( resumeYargs ) => {
				return resumeYargs.positional( 'id', {
					type: 'string',
					describe: __( 'Session id, id prefix, or "latest"' ),
				} );
			},
			handler: async ( argv ) => {
				try {
					const noSessionPersistence =
						( argv as { sessionPersistence?: boolean } ).sessionPersistence === false;
					await runResumeSessionCommand( typeof argv.id === 'string' ? argv.id : undefined, {
						noSessionPersistence,
					} );
				} catch ( error ) {
					if ( error instanceof LoggerError ) {
						logger.reportError( error );
					} else {
						const loggerError = new LoggerError( __( 'Failed to resume AI session' ), error );
						logger.reportError( loggerError );
					}
				}
			},
		} )
		.command( {
			command: 'delete [id]',
			describe: __( 'Delete an AI session (id, prefix, "latest", or picker)' ),
			builder: ( deleteYargs ) => {
				return deleteYargs.positional( 'id', {
					type: 'string',
					describe: __( 'Session id, id prefix, or "latest"' ),
				} );
			},
			handler: async ( argv ) => {
				try {
					await runDeleteSessionCommand( typeof argv.id === 'string' ? argv.id : undefined );
				} catch ( error ) {
					if ( error instanceof LoggerError ) {
						logger.reportError( error );
					} else {
						logger.reportError( new LoggerError( __( 'Failed to delete AI session' ), error ) );
					}
				}
			},
		} );
};
