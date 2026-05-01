import { AI_SKILL_COMMANDS } from '@studio/common/ai/slash-commands';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { __, sprintf } from '@wordpress/i18n';
import { AI_MODELS, type AiModelId } from 'cli/ai/agent';
import { getAvailableAiProviders, isAiProviderReady } from 'cli/ai/auth';
import { AI_PROVIDERS, type AiProviderId } from 'cli/ai/providers';
import { captureCommandOutput } from 'cli/ai/tools';
import { runCommand as runLoginCommand } from 'cli/commands/auth/login';
import { runCommand as runLogoutCommand } from 'cli/commands/auth/logout';
import { runCommand as runCreatePreviewCommand } from 'cli/commands/preview/create';
import { runCommand as runUpdatePreviewCommand } from 'cli/commands/preview/update';
import { isRemoteSessionEnabled } from 'cli/lib/feature-flags';
import { getSnapshotsFromConfig, isSnapshotExpired } from 'cli/lib/snapshots';
import { LoggerError } from 'cli/logger';
import { RemoteSessionConfigError } from 'cli/remote-session';
import { loadRemoteSessionConfig } from 'cli/remote-session/config';
import {
	DaemonAlreadyRunningError,
	DaemonStartTimeoutError,
	startDaemon,
	stopDaemon,
} from 'cli/remote-session/daemon';
import type { AutocompleteItem } from '@mariozechner/pi-tui';
import type { AiChatUI } from 'cli/ai/ui';

export interface SlashCommandContext {
	ui: AiChatUI;
	currentModel: AiModelId;
	currentProvider: AiProviderId;
	showCapabilitiesOnConnect: boolean;
	switchProvider( provider: AiProviderId, announce?: boolean ): Promise< void >;
	prepareProviderSelection(
		provider: AiProviderId,
		options?: { force?: boolean }
	): Promise< void >;
	maybeAutoSwitchProvider(): Promise< void >;
	persistSessionContext(): Promise< void >;
	clearSession(): Promise< void >;
}

export type SlashCommandHandler = (
	prompt: string,
	ctx: SlashCommandContext
) => Promise< 'continue' | 'break' >;

export interface SlashCommandDef {
	name: string;
	description: string;
	handler?: SlashCommandHandler;
	/**
	 * Optional gate. When provided and returning false at evaluation time, the
	 * command is hidden from autocomplete and unreachable from the dispatcher.
	 * Used for feature-flagged commands so the surface stays clean for users
	 * who haven't opted in.
	 */
	enabled?: () => boolean;
	/**
	 * Optional argument completion. When the user has typed past the first
	 * whitespace (e.g. `/remote-session `), the autocomplete provider calls
	 * this to surface subcommand suggestions.
	 */
	getArgumentCompletions?: ( argumentPrefix: string ) => AutocompleteItem[] | null;
}

/**
 * Returns the slash commands that should be visible/dispatchable right now.
 * Consumers (autocomplete + REPL dispatcher) should call this rather than
 * reading `AI_CHAT_SLASH_COMMANDS` directly so feature-flag flips take effect
 * without a restart.
 */
export function getActiveSlashCommands(): SlashCommandDef[] {
	return AI_CHAT_SLASH_COMMANDS.filter( ( c ) => c.enabled === undefined || c.enabled() );
}

function isPromptAbortError( error: unknown ): boolean {
	return (
		error instanceof Error &&
		[ 'AbortPromptError', 'CancelPromptError', 'ExitPromptError' ].includes( error.name )
	);
}

function parseRemoteSessionSubcommand( prompt: string ): 'start' | 'stop' | undefined {
	const tokens = prompt.trim().split( /\s+/ );
	const sub = tokens[ 1 ]?.toLowerCase();
	if ( sub === 'start' || sub === 'stop' ) {
		return sub;
	}
	return undefined;
}

async function runRemoteSessionStart( ctx: SlashCommandContext ): Promise< void > {
	// Validate config in-process so a missing token surfaces as an error in the
	// REPL rather than silently spawning a child that exits on its own.
	try {
		await loadRemoteSessionConfig();
	} catch ( error ) {
		if ( error instanceof RemoteSessionConfigError ) {
			ctx.ui.showError( error.message );
			return;
		}
		throw error;
	}

	try {
		const result = await startDaemon();
		ctx.ui.showSuccess(
			sprintf(
				/* translators: %d: daemon PID */
				__(
					'Remote-session started (PID %d). Message Dolly (@wordpress_com_bot) on Telegram to work with Studio.'
				),
				result.pid
			)
		);
		ctx.ui.setDaemonStatus( { running: true, pid: result.pid } );
	} catch ( error ) {
		if ( error instanceof DaemonAlreadyRunningError ) {
			ctx.ui.showInfo(
				sprintf(
					/* translators: %d: daemon PID */
					__(
						'Remote-session already running (PID %d). Message Dolly (@wordpress_com_bot) on Telegram to work with Studio.'
					),
					error.pid
				)
			);
			ctx.ui.setDaemonStatus( { running: true, pid: error.pid } );
			return;
		}
		if ( error instanceof DaemonStartTimeoutError ) {
			ctx.ui.showError( error.message );
			return;
		}
		throw error;
	}
}

async function runRemoteSessionStop( ctx: SlashCommandContext ): Promise< void > {
	let result;
	try {
		result = await stopDaemon();
	} catch ( error ) {
		// stopDaemon rethrows non-ESRCH errors from process.kill (e.g. EPERM
		// when the PID was reused by another user, or any unexpected fs error
		// while removing the PID file). The REPL dispatcher does not wrap
		// handlers in a try/catch, so we surface these as a friendly error
		// rather than letting them terminate the interactive session.
		ctx.ui.showError(
			error instanceof Error ? error.message : __( 'Failed to stop the remote-session daemon.' )
		);
		return;
	}
	ctx.ui.setDaemonStatus( { running: false } );
	if ( result.alreadyStopped ) {
		ctx.ui.showInfo( __( 'Remote-session daemon was not running.' ) );
		return;
	}
	if ( ! result.stopped ) {
		ctx.ui.showError(
			sprintf(
				/* translators: %d: daemon PID */
				__( 'Remote-session daemon (PID %d) did not exit after SIGKILL. PID file left in place.' ),
				result.pid ?? 0
			)
		);
		return;
	}
	if ( result.usedSigKill ) {
		ctx.ui.showInfo(
			sprintf(
				/* translators: %d: daemon PID */
				__( 'Remote-session daemon (PID %d) did not exit gracefully; sent SIGKILL.' ),
				result.pid ?? 0
			)
		);
		return;
	}
	ctx.ui.showSuccess(
		sprintf(
			/* translators: %d: daemon PID */
			__( 'Remote-session stopped (PID %d).' ),
			result.pid ?? 0
		)
	);
}

async function runRemoteSessionSlashCommand(
	prompt: string,
	ctx: SlashCommandContext
): Promise< 'continue' | 'break' > {
	const sub = parseRemoteSessionSubcommand( prompt );
	if ( sub === 'start' ) {
		await runRemoteSessionStart( ctx );
	} else if ( sub === 'stop' ) {
		await runRemoteSessionStop( ctx );
	} else {
		ctx.ui.showInfo( __( 'Usage: /remote-session [start|stop]' ) );
	}
	return 'continue';
}

export const AI_CHAT_SLASH_COMMANDS: SlashCommandDef[] = [
	{
		name: 'browser',
		description: __( 'Open the active site in the browser' ),
		handler: async ( _prompt, ctx ) => {
			const opened = await ctx.ui.openActiveSiteInBrowser();
			if ( ! opened ) {
				ctx.ui.showInfo( __( 'No site selected. Use ↓ to select a site first.' ) );
			}
			return 'continue';
		},
	},
	{
		name: 'clear',
		description: __( 'Clear the conversation and start a fresh session' ),
		handler: async ( _prompt, ctx ) => {
			await ctx.clearSession();
			return 'continue';
		},
	},
	{
		name: 'api-key',
		description: __( 'Set or update the Anthropic API key' ),
		handler: async ( _prompt, ctx ) => {
			try {
				await ctx.prepareProviderSelection( 'anthropic-api-key', { force: true } );
				ctx.ui.showInfo( __( 'Anthropic API key updated.' ) );
				if ( ctx.showCapabilitiesOnConnect ) {
					ctx.showCapabilitiesOnConnect = false;
					await ctx.switchProvider( 'anthropic-api-key' );
					ctx.ui.showCapabilities();
				}
			} catch ( error ) {
				if ( isPromptAbortError( error ) ) {
					ctx.ui.showInfo( __( 'API key update canceled.' ) );
					return 'continue';
				}
				if ( error instanceof LoggerError ) {
					ctx.ui.showError( error.message );
					return 'continue';
				}
				throw error;
			}
			return 'continue';
		},
	},
	{
		name: 'login',
		description: __( 'Log in to WordPress.com' ),
		handler: async ( _prompt, ctx ) => {
			ctx.ui.stop();
			await runLoginCommand();
			ctx.ui.start();
			if ( await isAiProviderReady( 'wpcom' ) ) {
				const token = await readAuthToken();
				if ( token ) {
					ctx.ui.showSuccess(
						sprintf(
							/* translators: 1: display name, 2: email */
							__( 'Logged in as %1$s (%2$s)' ),
							token.displayName,
							token.email
						)
					);
					ctx.ui.setStatusMessage(
						sprintf(
							/* translators: %s: display name */
							__( 'Logged in as %s' ),
							token.displayName
						)
					);
					if ( ctx.showCapabilitiesOnConnect ) {
						ctx.showCapabilitiesOnConnect = false;
						await ctx.switchProvider( 'wpcom' );
						ctx.ui.showCapabilities();
					}
				}
			} else {
				ctx.ui.setStatusMessage( __( 'Login failed or canceled' ) );
			}
			return 'continue';
		},
	},
	{
		name: 'logout',
		description: __( 'Log out of WordPress.com' ),
		handler: async ( _prompt, ctx ) => {
			ctx.ui.stop();
			await runLogoutCommand();
			ctx.ui.start();
			ctx.ui.setStatusMessage( __( 'Logged out of WordPress.com' ) );
			await ctx.maybeAutoSwitchProvider();
			return 'continue';
		},
	},
	{
		name: 'model',
		description: __( 'Switch the AI model' ),
		handler: async ( _prompt, ctx ) => {
			const modelOptions = ( Object.entries( AI_MODELS ) as [ AiModelId, string ][] ).map(
				( [ id, label ] ) => ( {
					label:
						id === ctx.currentModel
							? sprintf(
									/* translators: %s: model name */
									__( '%s (current)' ),
									label
							  )
							: label,
					description: id,
				} )
			);
			const answer = await ctx.ui.askUser( [
				{ question: __( 'Select a model' ), options: modelOptions },
			] );
			const selectedId = Object.values( answer )[ 0 ] as string;
			const newModel = ( Object.entries( AI_MODELS ) as [ AiModelId, string ][] ).find(
				( [ , label ] ) => selectedId.startsWith( label )
			);
			if ( newModel && newModel[ 0 ] !== ctx.currentModel ) {
				ctx.currentModel = newModel[ 0 ];
				ctx.ui.currentModel = ctx.currentModel;
				ctx.ui.showInfo(
					sprintf(
						/* translators: %s: model name */
						__( 'Switched to %s' ),
						AI_MODELS[ ctx.currentModel ]
					)
				);
				await ctx.persistSessionContext();
			}
			return 'continue';
		},
	},
	{
		name: 'provider',
		description: __( 'Switch the AI provider' ),
		handler: async ( _prompt, ctx ) => {
			const availableProviders = await getAvailableAiProviders();
			const providerOptions = availableProviders.map( ( id ) => ( {
				label:
					id === ctx.currentProvider
						? sprintf(
								/* translators: %s: provider name */
								__( '%s (current)' ),
								AI_PROVIDERS[ id ]
						  )
						: AI_PROVIDERS[ id ],
				description: id,
			} ) );
			const answer = await ctx.ui.askUser( [
				{ question: __( 'Select an AI provider' ), options: providerOptions },
			] );
			const selectedLabel = Object.values( answer )[ 0 ] as string;
			const newProvider = availableProviders.find( ( id ) =>
				selectedLabel.startsWith( AI_PROVIDERS[ id ] )
			);
			if ( newProvider && newProvider !== ctx.currentProvider ) {
				try {
					await ctx.prepareProviderSelection( newProvider );
					await ctx.switchProvider( newProvider );
				} catch ( error ) {
					if ( isPromptAbortError( error ) ) {
						ctx.ui.showInfo(
							sprintf(
								/* translators: %s: provider name */
								__( 'Provider setup canceled. Kept %s.' ),
								AI_PROVIDERS[ ctx.currentProvider ]
							)
						);
						return 'continue';
					}
					if ( error instanceof LoggerError ) {
						ctx.ui.showError( error.message );
						return 'continue';
					}
					throw error;
				}
			}
			return 'continue';
		},
	},
	{
		name: 'preview',
		description: __( 'Push the active site to WordPress.com as a preview' ),
		handler: async ( _prompt, ctx ) => {
			const site = ctx.ui.activeSite;
			if ( ! site ) {
				ctx.ui.showInfo( __( 'No site selected. Use ↓ to select a site first.' ) );
				return 'continue';
			}

			const token = await readAuthToken();
			if ( ! token ) {
				ctx.ui.showInfo( __( 'WordPress.com login required. Use /login to authenticate.' ) );
				return 'continue';
			}

			try {
				const snapshots = await getSnapshotsFromConfig( token.id, site.path );
				const activeSnapshot = snapshots.find( ( s ) => ! isSnapshotExpired( s ) );

				const isUpdate = Boolean( activeSnapshot );
				ctx.ui.showProgress(
					isUpdate
						? __( 'Updating preview site… this may take a moment.' )
						: __( 'Creating preview site… this may take a moment.' )
				);
				ctx.ui.setBusy( true );

				const result = await captureCommandOutput( async () => {
					if ( activeSnapshot ) {
						await runUpdatePreviewCommand( site.path, activeSnapshot.url, false );
					} else {
						await runCreatePreviewCommand( site.path );
					}
				} );

				ctx.ui.setBusy( false );

				if ( result.exitCode ) {
					ctx.ui.showError( result.consoleOutput || __( 'Failed to create preview site.' ) );
				} else {
					const updated = await getSnapshotsFromConfig( token.id, site.path );
					const latest = updated.find( ( s ) => ! isSnapshotExpired( s ) );
					if ( latest ) {
						const previewUrl = `https://${ latest.url }`;
						ctx.ui.showSuccess( __( 'Preview site ready!' ) + '\n\n   ' + previewUrl );
					} else {
						ctx.ui.showInfo( result.consoleOutput || __( 'Preview command completed.' ) );
					}
				}
			} catch ( error ) {
				ctx.ui.setBusy( false );
				if ( error instanceof LoggerError ) {
					ctx.ui.showError( error.message );
				} else {
					ctx.ui.showError( __( 'Failed to create preview site.' ) );
				}
			}
			return 'continue';
		},
	},
	{
		name: 'remote-session',
		description: __( 'Manage the Telegram remote-session daemon (start, stop)' ),
		enabled: isRemoteSessionEnabled,
		getArgumentCompletions: ( argumentPrefix ) => {
			const items: AutocompleteItem[] = [
				{ value: 'start', label: 'start', description: __( 'Spawn the daemon' ) },
				{ value: 'stop', label: 'stop', description: __( 'Stop the daemon' ) },
			];
			const lower = argumentPrefix.toLowerCase();
			return items.filter( ( item ) => item.value.startsWith( lower ) );
		},
		handler: runRemoteSessionSlashCommand,
	},
	{
		name: 'exit',
		description: __( 'Exit the chat' ),
		handler: async () => 'break',
	},
	...AI_SKILL_COMMANDS,
];
