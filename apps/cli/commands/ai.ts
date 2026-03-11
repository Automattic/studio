import { __ } from '@wordpress/i18n';
import { AI_MODELS, DEFAULT_MODEL, startAiAgent, type AiModelId } from 'cli/ai/agent';
import {
	getAvailableAiProviders,
	isAiProviderReady,
	prepareAiProvider,
	resolveAiEnvironment,
	resolveInitialAiProvider,
	resolveUnavailableAiProvider,
	saveSelectedAiProvider,
} from 'cli/ai/auth';
import { AI_PROVIDERS, type AiProviderId } from 'cli/ai/providers';
import {
	AI_CHAT_API_KEY_COMMAND,
	AI_CHAT_BROWSER_COMMAND,
	AI_CHAT_EXIT_COMMAND,
	AI_CHAT_LOGIN_COMMAND,
	AI_CHAT_LOGOUT_COMMAND,
	AI_CHAT_MODEL_COMMAND,
	AI_CHAT_PROVIDER_COMMAND,
} from 'cli/ai/slash-commands';
import { AiChatUI } from 'cli/ai/ui';
import { runCommand as runLoginCommand } from 'cli/commands/auth/login';
import { runCommand as runLogoutCommand } from 'cli/commands/auth/logout';
import { getAnthropicApiKey, getAuthToken } from 'cli/lib/appdata';
import { Logger, LoggerError, setProgressCallback } from 'cli/logger';
import { StudioArgv } from 'cli/types';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

const logger = new Logger< string >();

function isPromptAbortError( error: unknown ): boolean {
	return (
		error instanceof Error &&
		[ 'AbortPromptError', 'CancelPromptError', 'ExitPromptError' ].includes( error.name )
	);
}

function getErrorMessage( error: unknown ): string {
	if ( error instanceof Error ) {
		return error.message;
	}

	return String( error );
}

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

function extractAssistantMessageBlocks( message: SDKMessage ): AssistantMessageBlock[] {
	if ( message.type !== 'assistant' ) {
		return [];
	}

	const blocks: AssistantMessageBlock[] = [];
	for ( const block of message.message.content ) {
		if ( block.type === 'text' && block.text ) {
			blocks.push( {
				type: 'text',
				text: block.text,
			} );
		}

		if ( block.type === 'tool_use' && block.name ) {
			const detail =
				block.input && typeof block.input === 'object'
					? getToolDetail( block.name, block.input as Record< string, unknown > )
					: '';
			blocks.push( {
				type: 'tool_use',
				name: block.name,
				detail: detail || undefined,
			} );
		}
	}

	return blocks;
}

function toToolResultText( value: unknown ): string {
	if ( Array.isArray( value ) ) {
		const lines = value
			.map( ( item ) => {
				if ( typeof item === 'string' ) {
					return item;
				}

				if ( item && typeof item === 'object' ) {
					const typedItem = item as { type?: unknown; text?: unknown };
					if ( typedItem.type === 'text' && typeof typedItem.text === 'string' ) {
						return typedItem.text;
					}

					try {
						return JSON.stringify( item, null, 2 );
					} catch {
						return String( item );
					}
				}

				return String( item );
			} )
			.map( ( line ) => line.trim() )
			.filter( ( line ) => line.length > 0 );

		return lines.join( '\n' );
	}

	if ( typeof value === 'string' ) {
		return value.trim();
	}

	if ( value === null || value === undefined ) {
		return '';
	}

	try {
		return JSON.stringify( value, null, 2 );
	} catch {
		return String( value );
	}
}

function extractToolResult( message: SDKMessage ): { ok: boolean; text: string } | undefined {
	if ( message.type !== 'user' ) {
		return undefined;
	}

	const rawResult = message.tool_use_result;
	if ( ! rawResult ) {
		return undefined;
	}

	if ( typeof rawResult !== 'object' ) {
		const text = String( rawResult ).trim();
		return {
			ok: true,
			text,
		};
	}

	const typedResult = rawResult as {
		content?: unknown;
		isError?: unknown;
		is_error?: unknown;
	};
	const isError = typedResult.isError === true || typedResult.is_error === true;
	const textFromContent = toToolResultText( typedResult.content );

	return {
		ok: ! isError,
		text: textFromContent,
	};
}

export async function runCommand(): Promise< void > {
	const ui = new AiChatUI();
	let currentProvider: AiProviderId = await resolveInitialAiProvider();
	ui.currentProvider = currentProvider;
	setProgressCallback( ( message ) => ui.setLoaderMessage( message ) );
	ui.start();
	ui.showWelcome();

	let sessionRecorder: AiSessionRecorder | undefined;
	let didDisableSessionPersistence = false;
	let sessionId: string | undefined = options.resumeSession?.summary.agentSessionId;

	try {
		if ( options.resumeSession ) {
			sessionRecorder = await AiSessionRecorder.open( {
				sessionId: options.resumeSession.summary.id,
				filePath: options.resumeSession.summary.filePath,
				linkedAgentSessionIds: options.resumeSession.summary.linkedAgentSessionIds,
			} );
		} else {
			sessionRecorder = await AiSessionRecorder.create();
		}
	} catch ( error ) {
		didDisableSessionPersistence = true;
		ui.showError( `Session persistence disabled: ${ getErrorMessage( error ) }` );
	}

	const persist = async ( callback: ( recorder: AiSessionRecorder ) => Promise< void > ) => {
		if ( ! sessionRecorder ) {
			return;
		}

		try {
			await callback( sessionRecorder );
		} catch ( error ) {
			sessionRecorder = undefined;
			if ( ! didDisableSessionPersistence ) {
				didDisableSessionPersistence = true;
				ui.showError( `Session persistence disabled: ${ getErrorMessage( error ) }` );
			}
		}
	};

	setProgressCallback( ( message ) => {
		ui.setLoaderMessage( message );
		void persist( ( recorder ) => recorder.recordToolProgress( message ) );
	} );

	let currentModel: AiModelId = DEFAULT_MODEL;

	async function prepareProviderSelection(
		provider: AiProviderId,
		options?: { force?: boolean }
	): Promise< void > {
		ui.stop();
		try {
			await prepareAiProvider( provider, options );
		} finally {
			ui.start();
		}
	}

	async function switchProvider( provider: AiProviderId, announce = true ): Promise< void > {
		currentProvider = provider;
		ui.currentProvider = currentProvider;
		sessionId = undefined;
		await saveSelectedAiProvider( currentProvider );
		if ( announce ) {
			ui.showInfo( `Switched to ${ AI_PROVIDERS[ currentProvider ] }` );
		}
	}

	async function maybeAutoSwitchProvider(): Promise< void > {
		const fallbackProvider = await resolveUnavailableAiProvider( currentProvider );
		if ( ! fallbackProvider || fallbackProvider === currentProvider ) {
			return;
		}

		const previousProvider = currentProvider;
		await switchProvider( fallbackProvider, false );
		ui.showInfo(
			`${ AI_PROVIDERS[ previousProvider ] } is no longer available. Switched to ${ AI_PROVIDERS[ currentProvider ] }.`
		);
	}

	function handleAgentTurnError( error: unknown ): void {
		sessionId = undefined;

		if ( error instanceof LoggerError ) {
			ui.showError( error.message );
		} else if ( error instanceof Error ) {
			ui.showError( error.message );
		} else {
			ui.showError( __( 'AI agent failed' ) );
		}

		if ( currentProvider === 'anthropic-api-key' ) {
			ui.showInfo( 'Use /api-key to update the Anthropic API key.' );
		}
	}

	if ( currentProvider === 'wpcom' ) {
		try {
			const token = await getAuthToken();
			ui.setStatusMessage( `Logged in as ${ token.displayName }` );
		} catch {
			ui.setStatusMessage( 'Use /login to authenticate to WordPress.com' );
		}
	}

	if ( currentProvider === 'anthropic-api-key' && ! ( await getAnthropicApiKey() ) ) {
		ui.showInfo( 'No Anthropic API key saved. Use /provider to enter one.' );
	}

	async function runAgentTurn( prompt: string ): Promise< void > {
		const env = await resolveAiEnvironment( currentProvider );
		ui.beginAgentTurn();

		// Prepend active site context to the prompt.
		// Remote (WordPress.com) sites only have a URL; local sites have a filesystem path and running state.
		let enrichedPrompt = prompt;
		const site = ui.activeSite;
		if ( site?.remote && site?.url ) {
			enrichedPrompt = `[Active site: "${ site.name }" at ${ site.url } (WordPress.com)]\n\n${ prompt }`;
		} else if ( site ) {
			enrichedPrompt = `[Active site: "${ site.name }" at ${ site.path }${
				site.running ? ' (running)' : ' (stopped)'
			}]\n\n${ prompt }`;
		}

		await persist( ( recorder ) =>
			recorder.recordUserMessage( {
				text: prompt,
				source: 'prompt',
				sitePath: site?.path,
			} )
		);

		const agentQuery = startAiAgent( {
			prompt: enrichedPrompt,
			env,
			model: currentModel,
			resume: sessionId,
			onAskUser: ( questions ) => askUserAndPersistAnswers( questions ),
		} );

		ui.onInterrupt = () => {
			void agentQuery.interrupt();
		};

		let maxTurnsResult: { numTurns: number; costUsd: number } | undefined;
		let turnStatus: TurnStatus = 'interrupted';

		try {
			for await ( const message of agentQuery ) {
				const assistantBlocks = extractAssistantMessageBlocks( message );
				if ( assistantBlocks.length > 0 ) {
					await persist( ( recorder ) => recorder.recordAssistantMessage( assistantBlocks ) );
				}

				const toolResult = extractToolResult( message );
				if ( toolResult ) {
					await persist( ( recorder ) => recorder.recordToolResult( toolResult ) );
				}

				const result = ui.handleMessage( message );
				if ( result ) {
					sessionId = result.sessionId;
					await persist( ( recorder ) => recorder.recordAgentSessionId( result.sessionId ) );

					if ( 'maxTurnsReached' in result && result.maxTurnsReached ) {
						maxTurnsResult = {
							numTurns: result.numTurns,
							costUsd: result.costUsd,
						};
						turnStatus = 'max_turns';
					} else {
						turnStatus = result.success ? 'success' : 'error';
					}
				}
			}
		} catch ( error ) {
			turnStatus = 'error';
			throw error;
		} finally {
			await persist( ( recorder ) => recorder.recordTurnClosed( turnStatus ) );
			ui.endAgentTurn();
		}

		if ( maxTurnsResult ) {
			ui.showInfo(
				`Used ${ maxTurnsResult.numTurns } turns · $${ maxTurnsResult.costUsd.toFixed( 4 ) }`
			);
			const answer = await ui.askUser( [
				{
					question: 'Reached the turn limit. Continue?',
					options: [
						{ label: 'Yes', description: 'Resume where the agent left off' },
						{ label: 'No', description: 'Stop here' },
					],
				},
			] );
			const choice = Object.values( answer )[ 0 ]?.toLowerCase();
			if ( choice === 'yes' ) {
				ui.addUserMessage( 'Continue' );
				await runAgentTurn( 'Continue from where you left off.' );
			}
		}
	}

	try {
		while ( true ) {
			const prompt = await ui.waitForInput();
			const trimmedPrompt = prompt.trim();

			if ( trimmedPrompt === AI_CHAT_EXIT_COMMAND ) {
				break;
			}

			if ( trimmedPrompt === AI_CHAT_BROWSER_COMMAND ) {
				const opened = await ui.openActiveSiteInBrowser();
				if ( ! opened ) {
					ui.showInfo( 'No site selected. Use ↓ to select a site first.' );
				}
				continue;
			}

			if ( trimmedPrompt === AI_CHAT_API_KEY_COMMAND ) {
				try {
					await prepareProviderSelection( 'anthropic-api-key', { force: true } );
					ui.showInfo( 'Anthropic API key updated.' );
				} catch ( error ) {
					if ( isPromptAbortError( error ) ) {
						ui.showInfo( 'API key update canceled.' );
						continue;
					}
					if ( error instanceof LoggerError ) {
						ui.showError( error.message );
						continue;
					}
					throw error;
				}
				continue;
			}

			if ( trimmedPrompt === AI_CHAT_LOGIN_COMMAND ) {
				ui.stop();
				await runLoginCommand();
				ui.start();
				if ( await isAiProviderReady( 'wpcom' ) ) {
					const token = await getAuthToken();
					ui.showInfo( `Logged in as ${ token.displayName } (${ token.email })` );
					ui.setStatusMessage( `Logged in as ${ token.displayName }` );
				} else {
					ui.setStatusMessage( 'Login failed or canceled' );
				}
				continue;
			}

			if ( trimmedPrompt === AI_CHAT_LOGOUT_COMMAND ) {
				ui.stop();
				await runLogoutCommand();
				ui.start();
				ui.setStatusMessage( 'Logged out of WordPress.com' );
				await maybeAutoSwitchProvider();
				continue;
			}

			if ( trimmedPrompt === AI_CHAT_MODEL_COMMAND ) {
				const modelOptions = ( Object.entries( AI_MODELS ) as [ AiModelId, string ][] ).map(
					( [ id, label ] ) => ( {
						label: id === currentModel ? `${ label } (current)` : label,
						description: id,
					} )
				);
				const answer = await ui.askUser( [
					{ question: 'Select a model', options: modelOptions },
				] );
				const selectedId = Object.values( answer )[ 0 ] as string;
				const newModel = ( Object.entries( AI_MODELS ) as [ AiModelId, string ][] ).find(
					( [ , label ] ) => selectedId.startsWith( label )
				);
				if ( newModel && newModel[ 0 ] !== currentModel ) {
					currentModel = newModel[ 0 ];
					ui.currentModel = currentModel;
					ui.showInfo( `Switched to ${ AI_MODELS[ currentModel ] }` );
				}
				continue;
			}

			if ( trimmedPrompt === AI_CHAT_PROVIDER_COMMAND ) {
				const availableProviders = await getAvailableAiProviders();
				const providerOptions = availableProviders.map( ( id ) => ( {
					label: id === currentProvider ? `${ AI_PROVIDERS[ id ] } (current)` : AI_PROVIDERS[ id ],
					description: id,
				} ) );
				const answer = await ui.askUser( [
					{ question: 'Select an AI provider', options: providerOptions },
				] );
				const selectedLabel = Object.values( answer )[ 0 ] as string;
				const newProvider = availableProviders.find( ( id ) =>
					selectedLabel.startsWith( AI_PROVIDERS[ id ] )
				);
				if ( newProvider && newProvider !== currentProvider ) {
					try {
						await prepareProviderSelection( newProvider );
						await switchProvider( newProvider );
					} catch ( error ) {
						if ( isPromptAbortError( error ) ) {
							ui.showInfo( `Provider setup canceled. Kept ${ AI_PROVIDERS[ currentProvider ] }.` );
							continue;
						}
						if ( error instanceof LoggerError ) {
							ui.showError( error.message );
							continue;
						}
						throw error;
					}
				}
				continue;
			}

			await maybeAutoSwitchProvider();

			ui.addUserMessage( prompt );
			try {
				await runAgentTurn( prompt );
			} catch ( error ) {
				handleAgentTurnError( error );
			}
		}
	} finally {
		ui.stop();
		process.exit( 0 );
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'ai',
		describe: __( 'AI-powered WordPress assistant' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'path', {
					hidden: true,
				} )
				.command( {
					command: 'sessions',
					describe: __( 'Manage AI sessions' ),
					builder: ( sessionsYargs ) => {
						return sessionsYargs
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
											logger.reportError(
												new LoggerError( __( 'Failed to list AI sessions' ), error )
											);
										}
									}
								},
							} )
							.command( {
								command: 'resume <id>',
								describe: __( 'Resume an AI session (id or "latest")' ),
								builder: ( resumeYargs ) => {
									return resumeYargs.positional( 'id', {
										type: 'string',
										describe: __( 'Session id (or "latest")' ),
									} );
								},
								handler: async ( argv ) => {
									try {
										await runResumeSessionCommand( argv.id as string );
									} catch ( error ) {
										if ( error instanceof LoggerError ) {
											logger.reportError( error );
										} else {
											const loggerError = new LoggerError(
												__( 'Failed to resume AI session' ),
												error
											);
											logger.reportError( loggerError );
										}
									}
								},
							} )
							.command( {
								command: 'delete <id>',
								describe: __( 'Delete an AI session (id, prefix, or "latest")' ),
								builder: ( deleteYargs ) => {
									return deleteYargs.positional( 'id', {
										type: 'string',
										describe: __( 'Session id, id prefix, or "latest"' ),
									} );
								},
								handler: async ( argv ) => {
									try {
										await runDeleteSessionCommand( argv.id as string );
									} catch ( error ) {
										if ( error instanceof LoggerError ) {
											logger.reportError( error );
										} else {
											logger.reportError(
												new LoggerError( __( 'Failed to delete AI session' ), error )
											);
										}
									}
								},
							} )
							.version( false )
							.demandCommand( 1, __( 'You must provide a valid ai sessions command' ) );
					},
					handler: async () => {},
				} );
		},
		handler: async () => {
			try {
				await runCommand();
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'AI agent failed' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
