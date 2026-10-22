import { input, password, select } from '@inquirer/prompts';
import {
	aiModelRequiresPaidCredits,
	getAiModelFamily,
	getAiModelLabel,
	type AiModelFamily,
	type AiModelId,
	type SelectedModelId,
} from '@studio/common/ai/models';
import { getAiSkillCommands } from '@studio/common/ai/slash-commands';
import {
	isAutomatticianFromToken,
	readAuthToken,
	getActiveOpenAiCompatibleEndpoint,
	saveActiveOpenAiCompatibleEndpoint,
} from '@studio/common/lib/shared-config';
import {
	clampQuotaFraction,
	fetchStudioAssistantQuota,
	formatQuotaPercentage,
	getAddAiCreditsUrl,
	hasPaidAiCredits,
	type StudioAssistantQuota,
} from '@studio/common/lib/studio-assistant-quota';
import {
	fetchStudioAssistantTopUpPricing,
	formatTopUpOptionCreditsLabel,
} from '@studio/common/lib/studio-assistant-top-up-pricing';
import { __, sprintf } from '@wordpress/i18n';
import { getAvailableAiProviders, isAiProviderReady } from 'cli/ai/auth';
import { discoverOpenAiCompatibleModels } from 'cli/ai/openai-compatible';
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
import type { AiChatUI } from 'cli/ai/ui';

export interface SlashCommandContext {
	ui: AiChatUI;
	currentModel: SelectedModelId;
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

/**
 * A conversation's recorded turns carry one provider's shapes — Anthropic
 * thinking blocks and tool_use ids, or OpenAI reasoning items. Rather than
 * replay those to an endpoint speaking the other protocol and rely on every
 * historical entry translating cleanly, a switch across families starts fresh.
 */
async function clearSessionAcrossFamilies(
	ctx: SlashCommandContext,
	previousFamily: AiModelFamily
): Promise< void > {
	if ( getAiModelFamily( ctx.currentModel ) === previousFamily ) {
		return;
	}
	await ctx.clearSession();
	ctx.ui.showInfo(
		__(
			"Switching across model families starts a fresh conversation — the prior turns aren't carried over."
		)
	);
}

/**
 * Print the account's AI credit balance. Which figure exists depends on the
 * account: the server reports the two credit pools only where AI credits are
 * enabled (their absence — not a zero — means the older monthly-cap design),
 * and reports neither when it can't price the account at all.
 */
function showCreditBalance( ctx: SlashCommandContext, quota: StudioAssistantQuota | null ): void {
	const credits = new Intl.NumberFormat();
	if (
		quota &&
		( quota.allowanceRemaining !== undefined || quota.purchasedRemaining !== undefined )
	) {
		// One showInfo for all the lines: each call pads itself with blank
		// lines, so per-line calls read as separate paragraphs.
		const lines = [];
		if ( ( quota.allowanceRemaining ?? 0 ) > 0 ) {
			lines.push(
				sprintf(
					/* translators: %s: number of free AI credits remaining (e.g. 960,000). */
					__( 'Free credits remaining: %s' ),
					credits.format( quota.allowanceRemaining ?? 0 )
				)
			);
		}
		lines.push(
			sprintf(
				/* translators: %s: number of purchased AI credits remaining (e.g. 150,000). */
				__( 'Purchased credits remaining: %s' ),
				credits.format( quota.purchasedRemaining ?? 0 )
			)
		);
		ctx.ui.showInfo( lines.join( '\n' ) );
		return;
	}
	if ( quota && quota.costCap > 0 ) {
		ctx.ui.showInfo(
			sprintf(
				/* translators: %s: percentage of monthly limit used (e.g. 7.5%). */
				__( '%s of monthly limit used' ),
				formatQuotaPercentage( clampQuotaFraction( quota.costUsage, quota.costCap ) )
			)
		);
		return;
	}
	ctx.ui.showInfo( __( 'Studio Code limits are temporarily unavailable.' ) );
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
		name: 'credits',
		description: __( 'Show your AI credit balance and buy more' ),
		handler: async ( _prompt, ctx ) => {
			const token = await readAuthToken();
			if ( ! token?.accessToken ) {
				ctx.ui.showInfo( __( 'WordPress.com login required. Use /login to authenticate.' ) );
				return 'continue';
			}

			ctx.ui.showProgress( __( 'Fetching your AI credits…' ) );
			ctx.ui.setBusy( true );
			// Independent endpoints, and neither is a gate on the other: the
			// balance is worth printing when pricing is down, and the top-ups
			// are worth offering when the balance can't be read.
			const [ quota, pricing ] = await Promise.all( [
				fetchStudioAssistantQuota( token.accessToken ),
				fetchStudioAssistantTopUpPricing( token.accessToken ),
			] );
			ctx.ui.setBusy( false );

			showCreditBalance( ctx, quota );

			// Whatever the store priced for this account, in whatever number.
			// With no pricing at all the fixed top-up still checks out, so it
			// stands in rather than leaving the user with nothing to pick.
			const options = pricing?.options ?? [];
			const choices: { label: string; description: string; credits?: number }[] = options.length
				? options.map( ( option ) => ( {
						label: formatTopUpOptionCreditsLabel( option ),
						description: option.display,
						credits: option.credits,
				  } ) )
				: [
						{
							label: __( 'Add AI credits' ),
							description: __( 'Pricing unavailable — opens WordPress.com checkout' ),
						},
				  ];

			try {
				const answer = await ctx.ui.askUser( [
					{
						question: __( 'Select a top-up to buy' ),
						options: choices.map( ( { label, description } ) => ( { label, description } ) ),
					},
				] );
				const selectedLabel = Object.values( answer )[ 0 ] as string;
				const choice = choices.find( ( candidate ) => candidate.label === selectedLabel );
				if ( ! choice ) {
					ctx.ui.showInfo( __( 'No top-up selected.' ) );
					return 'continue';
				}

				// The terminal has nothing for checkout to return to, so the URL
				// carries no `wp-studio://` return parameters.
				const url = getAddAiCreditsUrl( { returnsToDesktop: false, credits: choice.credits } );
				await openBrowser( url );
				// The terminal can't render a link, so the URL goes on its own
				// line, as-is — it stays copyable and most terminals auto-link it.
				ctx.ui.showInfo(
					__( 'Opening WordPress.com checkout. If your browser didn’t open, use the link below:' ) +
						'\n' +
						url
				);
			} catch ( error ) {
				ctx.ui.setBusy( false );
				if ( isPromptAbortError( error ) ) {
					ctx.ui.showInfo( __( 'Canceled.' ) );
					return 'continue';
				}
				ctx.ui.showError( __( 'Failed to open WordPress.com checkout.' ) );
			}
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
		name: 'openai-config',
		description: __( 'Configure a local OpenAI-compatible endpoint (base URL, key, model)' ),
		handler: async ( _prompt, ctx ) => {
			const existing = await getActiveOpenAiCompatibleEndpoint();
			const previousFamily = getAiModelFamily( ctx.currentModel );
			// Interactive prompts need the raw terminal, so pause the chat UI —
			// same pattern as /login.
			ctx.ui.stop();
			try {
				const baseUrl = (
					await input( {
						message: __( 'OpenAI-compatible base URL (e.g. http://localhost:11435/v1):' ),
						default: existing?.baseUrl,
						validate: ( value ) => ( value.trim() ? true : __( 'Base URL is required' ) ),
					} )
				).trim();
				const apiKeyInput = (
					await password( {
						message: existing?.apiKey
							? __( 'API key (leave blank to keep the saved one, "-" to remove it):' )
							: __( 'API key, if required (leave blank if none):' ),
						mask: '*',
					} )
				).trim();
				// Blank keeps what's saved: the prompt can't show a masked default,
				// so treating blank as "clear it" silently breaks the next request.
				const apiKey = apiKeyInput === '-' ? undefined : apiKeyInput || existing?.apiKey;

				// Discover the endpoint's models so the user picks a real one.
				const models = await discoverOpenAiCompatibleModels( baseUrl, apiKey );
				let selectedModel: string;
				if ( models.length > 0 ) {
					selectedModel = await select( {
						message: __( 'Select a model:' ),
						choices: models.map( ( model ) => ( {
							name: model.contextWindow
								? sprintf(
										/* translators: 1: model id, 2: context window in tokens */
										__( '%1$s (%2$s-token context)' ),
										model.id,
										model.contextWindow.toLocaleString()
								  )
								: model.id,
							value: model.id,
						} ) ),
					} );
				} else {
					// The chat UI is stopped here, so its showInfo would never be
					// seen — the explanation has to ride along on the prompt itself.
					selectedModel = (
						await input( {
							message: __( "Couldn't list models from the endpoint. Model id:" ),
							default: existing?.selectedModel,
							validate: ( value ) => ( value.trim() ? true : __( 'Model id is required' ) ),
						} )
					).trim();
				}

				await saveActiveOpenAiCompatibleEndpoint( {
					baseUrl,
					apiKey,
					selectedModel,
					contextWindow: models.find( ( model ) => model.id === selectedModel )?.contextWindow,
				} );
				ctx.currentModel = selectedModel;
				// The provider switch below only refreshes the footer when it has
				// to correct the model, and a local id needs no correcting.
				ctx.ui.currentModel = selectedModel;
			} catch ( error ) {
				ctx.ui.start();
				if ( isPromptAbortError( error ) ) {
					ctx.ui.showInfo( __( 'OpenAI-compatible setup canceled.' ) );
					return 'continue';
				}
				throw error;
			}
			ctx.ui.start();
			ctx.ui.showInfo( __( 'OpenAI-compatible endpoint updated.' ) );
			await ctx.switchProvider( 'openai-compatible' );
			await clearSessionAcrossFamilies( ctx, previousFamily );
			if ( ctx.showCapabilitiesOnConnect ) {
				ctx.showCapabilitiesOnConnect = false;
				ctx.ui.showCapabilities();
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
			const definition = getAiProviderDefinition( ctx.currentProvider );
			// Providers with dynamic models (e.g. openai-compatible) list the
			// endpoint's live models; the rest use the built-in catalog, gated
			// on purchased credits.
			const dynamicModels = await definition.listDynamicModels?.();
			let offeredModels: readonly SelectedModelId[];
			if ( dynamicModels ) {
				if ( dynamicModels.length === 0 ) {
					ctx.ui.showInfo(
						__(
							'No models available for this provider. For OpenAI-compatible, check the endpoint with /openai-config.'
						)
					);
					return 'continue';
				}
				offeredModels = dynamicModels.map( ( model ) => model.id );
			} else {
				const { availableModels } = definition;
				// The paid tiers are only offered while purchased credits remain;
				// Automatticians are exempt. The current model always stays listed,
				// so a session already on a paid tier keeps showing what it runs on.
				let catalogModels: readonly AiModelId[] = availableModels;
				if (
					availableModels.some( aiModelRequiresPaidCredits ) &&
					! ( await isAutomatticianFromToken() )
				) {
					const token = await readAuthToken();
					const quota = token ? await fetchStudioAssistantQuota( token.accessToken ) : null;
					if ( ! hasPaidAiCredits( quota ) ) {
						catalogModels = availableModels.filter(
							( id ) => id === ctx.currentModel || ! aiModelRequiresPaidCredits( id )
						);
					}
				}
				if ( catalogModels.length < availableModels.length ) {
					ctx.ui.showInfo(
						__( 'Models that need purchased AI credits are hidden — add credits to unlock them.' )
					);
				}
				offeredModels = catalogModels;
			}
			// Build options and a reverse lookup at the same time so we never
			// have to recover the model id from the label. A startsWith-based
			// match is buggy when one model's label is a prefix of another's
			// (e.g. "GPT 5.6" prefixes "GPT 5.6 Sol" — picking Sol silently
			// returns the other id), so we keep the label → id mapping
			// explicit here and look up by exact match below.
			const labelToId = new Map< string, SelectedModelId >();
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
				// A dynamic model's label is already its id, so repeating it as the
				// description wastes the line — show its context window instead.
				const contextWindow = dynamicModels?.find( ( model ) => model.id === id )?.contextWindow;
				return {
					label,
					description: contextWindow
						? sprintf(
								/* translators: %s: context window in tokens */
								__( '%s-token context' ),
								contextWindow.toLocaleString()
						  )
						: id,
				};
			} );
			const answer = await ctx.ui.askUser( [
				{ question: __( 'Select a model' ), options: modelOptions },
			] );
			const selectedLabel = Object.values( answer )[ 0 ] as string;
			const newModel = labelToId.get( selectedLabel );
			// For a dynamic provider, persist the selection to its endpoint so it
			// survives restarts and drives resolveEnv's context-window discovery.
			if ( newModel && dynamicModels && ctx.currentProvider === 'openai-compatible' ) {
				const endpoint = await getActiveOpenAiCompatibleEndpoint();
				if ( endpoint ) {
					await saveActiveOpenAiCompatibleEndpoint( {
						...endpoint,
						selectedModel: newModel,
						contextWindow: dynamicModels.find( ( model ) => model.id === newModel )?.contextWindow,
					} );
				}
			}
			if ( newModel && newModel !== ctx.currentModel ) {
				const previousFamily = getAiModelFamily( ctx.currentModel );
				// Swap the model first: a cross-family clear re-renders the
				// welcome banner and records a session context, both of which
				// should already name the model the next turn will use.
				ctx.currentModel = newModel;
				ctx.ui.currentModel = ctx.currentModel;
				await clearSessionAcrossFamilies( ctx, previousFamily );
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
				const previousFamily = getAiModelFamily( ctx.currentModel );
				try {
					await ctx.prepareProviderSelection( newProvider );
					await ctx.switchProvider( newProvider );
					await clearSessionAcrossFamilies( ctx, previousFamily );
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

				const result = await captureCommandOutput(
					async ( logger ) => {
						if ( activeSnapshot ) {
							await runUpdatePreviewCommand( site.path, activeSnapshot.url, false, logger );
						} else {
							await runCreatePreviewCommand( site.path, undefined, logger );
						}
					},
					( message, update ) => ctx.ui.setLoaderMessage( message, update )
				);

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

				const result = await captureCommandOutput(
					( logger ) => runPushCommand( site.path, [ 'all' ], String( remoteSite.id ), logger ),
					( message, update ) => ctx.ui.setLoaderMessage( message, update )
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
