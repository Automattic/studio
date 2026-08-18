import { getAiModelFamily, getVisibleAiModels } from '@studio/common/ai/models';
import { getAiModelLabel, type AiModelId } from '@studio/common/ai/models';
import { getAiSkillCommands } from '@studio/common/ai/slash-commands';
import { isAutomatticianFromToken, readAuthToken } from '@studio/common/lib/shared-config';
import { __, sprintf } from '@wordpress/i18n';
import { getAvailableAiProviders, isAiProviderReady } from 'cli/ai/auth';
import { AI_PROVIDERS, getAiProviderDefinition, type AiProviderId } from 'cli/ai/providers';
import { captureCommandOutput } from 'cli/ai/tools';
import { runCommand as runLoginCommand } from 'cli/commands/auth/login';
import { runCommand as runLogoutCommand } from 'cli/commands/auth/logout';
import { runCommand as runCreatePreviewCommand } from 'cli/commands/preview/create';
import { runCommand as runUpdatePreviewCommand } from 'cli/commands/preview/update';
import { runCommand as runPushCommand } from 'cli/commands/push';
import { openBrowser } from 'cli/lib/browser';
import { getSnapshotsFromConfig, isSnapshotExpired } from 'cli/lib/snapshots';
import { fetchSyncableSites } from 'cli/lib/sync-api';
import { LoggerError } from 'cli/logger';
import { loadRemoteSessionConfig } from 'cli/remote-session/config';
import { DaemonAlreadyRunningError, startDaemon, stopDaemon } from 'cli/remote-session/daemon';
import type { AutocompleteItem } from '@earendil-works/pi-tui';
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
	 * Optional argument completion. When the user has typed past the first
	 * whitespace (e.g. `/remote-session `), the autocomplete provider calls
	 * this to surface subcommand suggestions.
	 */
	getArgumentCompletions?: ( argumentPrefix: string ) => AutocompleteItem[] | null;
}

export function getActiveSlashCommands(): SlashCommandDef[] {
	// Alphabetical order is what the autocomplete shows for a bare `/`; once
	// the user types a query, fuzzy-match scoring takes over the ordering.
	return [ ...AI_CHAT_SLASH_COMMANDS ].sort( ( a, b ) => a.name.localeCompare( b.name ) );
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
		// RemoteSessionConfigError already carries a user-facing message
		// telling the user how to authenticate. Anything else (fs permissions,
		// JSON parse, etc.) gets a generic surface so the REPL stays alive —
		// the dispatcher does not catch handler throws.
		ctx.ui.showError(
			error instanceof Error ? error.message : __( 'Failed to load remote-session config.' )
		);
		return;
	}

	try {
		const result = await startDaemon();
		ctx.ui.showSuccess(
			sprintf(
				/* translators: %d: daemon PID */
				__(
					'Remote-session started (PID %d). Message WordPress Agent (@wordpressagentbot) on Telegram to work with Studio.'
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
						'Remote-session already running (PID %d). Message WordPress Agent (@wordpressagentbot) on Telegram to work with Studio.'
					),
					error.pid
				)
			);
			ctx.ui.setDaemonStatus( { running: true, pid: error.pid } );
			return;
		}
		// DaemonStartTimeoutError and any other unexpected errors (spawn
		// failure, fs write failure, etc.) get surfaced via showError so the
		// REPL stays alive.
		ctx.ui.showError(
			error instanceof Error ? error.message : __( 'Failed to start the remote-session daemon.' )
		);
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

async function pickRemoteSessionSubcommand(
	ctx: SlashCommandContext
): Promise< 'start' | 'stop' | undefined > {
	try {
		const answer = await ctx.ui.askUser( [
			{
				question: __( 'Remote session' ),
				options: [
					{ label: __( 'Start' ), description: __( 'Spawn the daemon' ) },
					{ label: __( 'Stop' ), description: __( 'Stop the daemon' ) },
				],
			},
		] );
		const selected = ( Object.values( answer )[ 0 ] as string | undefined )?.toLowerCase();
		if ( selected === undefined ) {
			return undefined;
		}
		if ( selected.startsWith( 'start' ) ) {
			return 'start';
		}
		if ( selected.startsWith( 'stop' ) ) {
			return 'stop';
		}
		return undefined;
	} catch ( error ) {
		if ( isPromptAbortError( error ) ) {
			return undefined;
		}
		throw error;
	}
}

async function runRemoteSessionSlashCommand(
	prompt: string,
	ctx: SlashCommandContext
): Promise< 'continue' | 'break' > {
	let sub = parseRemoteSessionSubcommand( prompt );
	if ( sub === undefined ) {
		const tokens = prompt.trim().split( /\s+/ );
		// `tokens.length > 1` means the user typed something like
		// `/remote-session bogus` — surface usage rather than silently popping
		// a picker that ignores the bad input.
		if ( tokens.length > 1 ) {
			ctx.ui.showInfo( __( 'Usage: /remote-session [start|stop]' ) );
			return 'continue';
		}
		sub = await pickRemoteSessionSubcommand( ctx );
		if ( sub === undefined ) {
			ctx.ui.showInfo( __( 'Remote session selection canceled.' ) );
			return 'continue';
		}
	}
	if ( sub === 'start' ) {
		await runRemoteSessionStart( ctx );
	} else if ( sub === 'stop' ) {
		await runRemoteSessionStop( ctx );
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
			const { availableModels } = getAiProviderDefinition( ctx.currentProvider );
			const visible = new Set(
				getVisibleAiModels( await isAutomatticianFromToken(), ctx.currentModel ).map(
					( model ) => model.id
				)
			);
			const offeredModels = availableModels.filter( ( id ) => visible.has( id ) );
			// Build options and a reverse lookup at the same time so we never
			// have to recover the model id from the label. A startsWith-based
			// match is buggy when one model's label is a prefix of another's
			// (e.g. "GPT 5.6" prefixes "GPT 5.6 Sol" — picking Sol silently
			// returns the other id), so we keep the label → id mapping
			// explicit here and look up by exact match below.
			const labelToId = new Map< string, AiModelId >();
			const modelOptions = offeredModels.map( ( id ) => {
				const label =
					id === ctx.currentModel
						? sprintf(
								/* translators: %s: model name */
								__( '%s (current)' ),
								getAiModelLabel( id )
						  )
						: getAiModelLabel( id );
				labelToId.set( label, id );
				return { label, description: id };
			} );
			const answer = await ctx.ui.askUser( [
				{ question: __( 'Select a model' ), options: modelOptions },
			] );
			const selectedLabel = Object.values( answer )[ 0 ] as string;
			const newModel = labelToId.get( selectedLabel );
			if ( newModel && newModel !== ctx.currentModel ) {
				// Switching to a model in a different family (Anthropic ↔ OpenAI)
				// hands the next turn off to a different runtime. Each runtime keeps
				// its own session store, so the existing session id from the previous
				// runtime won't resolve there ("No conversation found"). Clear the
				// session before the model swap so the new runtime starts fresh.
				const familyChanged = getAiModelFamily( ctx.currentModel ) !== getAiModelFamily( newModel );
				if ( familyChanged ) {
					await ctx.clearSession();
					ctx.ui.showInfo(
						__(
							"Switching across model families starts a fresh conversation — the prior turns aren't carried over."
						)
					);
				}

				ctx.currentModel = newModel;
				ctx.ui.currentModel = ctx.currentModel;
				ctx.ui.showInfo(
					sprintf(
						/* translators: %s: model name */
						__( 'Switched to %s' ),
						getAiModelLabel( ctx.currentModel )
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
		name: 'publish',
		description: __( 'Publish the active site to WordPress.com' ),
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
				ctx.ui.showProgress( __( 'Fetching your WordPress.com sites…' ) );
				ctx.ui.setBusy( true );

				const remoteSites = await fetchSyncableSites( token.accessToken );
				const syncable = remoteSites.filter( ( s ) => s.syncSupport === 'syncable' );

				if ( syncable.length === 0 ) {
					ctx.ui.setBusy( false );
					const checkoutUrl = new URL( 'https://wordpress.com/setup/new-hosted-site' );
					checkoutUrl.searchParams.set( 'ref', 'studio' );
					checkoutUrl.searchParams.set( 'section', 'studio-sync' );
					checkoutUrl.searchParams.set( 'showDomainStep', 'true' );
					checkoutUrl.searchParams.set( 'new', site.name );

					await openBrowser( checkoutUrl.toString() );
					ctx.ui.showInfo(
						__(
							'No WordPress.com sites found. Opening WordPress.com to create one — once your site is ready, run /publish again.'
						)
					);
					return 'continue';
				}

				// Let the user pick which site to publish to.
				const siteOptions = syncable.map( ( s ) => ( {
					label: s.name,
					description: s.url,
				} ) );
				ctx.ui.setBusy( false );
				const answer = await ctx.ui.askUser( [
					{
						question: __( 'Select a WordPress.com site to publish to' ),
						options: siteOptions,
					},
				] );
				const selectedName = Object.values( answer )[ 0 ] as string;
				const remoteSite = syncable.find( ( s ) => s.name === selectedName );
				if ( ! remoteSite ) {
					ctx.ui.showInfo( __( 'No site selected.' ) );
					return 'continue';
				}

				ctx.ui.showProgress(
					sprintf( __( 'Publishing to %s… this may take several minutes.' ), remoteSite.name )
				);
				ctx.ui.setBusy( true );

				const result = await captureCommandOutput( () =>
					runPushCommand( site.path, [ 'all' ], String( remoteSite.id ) )
				);

				ctx.ui.setBusy( false );

				if ( result.exitCode ) {
					ctx.ui.showError( result.consoleOutput || __( 'Failed to publish site.' ) );
				} else {
					ctx.ui.showSuccess(
						sprintf( __( 'Published to %s' ), remoteSite.url ) + '\n\n   ' + remoteSite.url
					);
				}
			} catch ( error ) {
				ctx.ui.setBusy( false );
				if ( isPromptAbortError( error ) ) {
					ctx.ui.showInfo( __( 'Publish canceled.' ) );
					return 'continue';
				}
				if ( error instanceof LoggerError ) {
					ctx.ui.showError( error.message );
				} else {
					ctx.ui.showError( __( 'Failed to publish site.' ) );
				}
			}
			return 'continue';
		},
	},
	{
		name: 'remote-session',
		description: __( 'Manage the Telegram remote-session daemon (start, stop)' ),
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
		name: 'swag',
		description: __( 'Treat yourself to some WordPress swag' ),
		handler: async () => {
			await openBrowser( 'https://mercantile.wordpress.org/' );
			return 'continue';
		},
	},
	{
		name: 'exit',
		description: __( 'Exit the chat' ),
		handler: async () => 'break',
	},
	...getAiSkillCommands(),
];
