import { Readable, Writable } from 'node:stream';
import {
	agent,
	ndJsonStream,
	PROTOCOL_VERSION,
	RequestError,
	type AgentContext,
	type ClientCapabilities,
	type ContentBlock,
	type SessionConfigOption,
	type SessionInfo,
	type SessionUpdate,
} from '@agentclientprotocol/sdk';
import {
	isStudioChatImageMimeType,
	validateStudioChatImages,
	type StudioChatImage,
} from '@studio/common/ai/chat-images';
import { getAgentEndFailure } from '@studio/common/ai/json-events';
import {
	getAiModelLabel,
	isAiModelId,
	readRecordedSessionModel,
	type AiModelId,
} from '@studio/common/ai/models';
import {
	AI_PROVIDER_LABELS,
	getAiProviderDefaultModel,
	getAiProviderModels,
	isAiProviderId,
	providerServesModel,
	resolveSessionProvider,
} from '@studio/common/ai/providers';
import { getAgentEndTurnResult } from '@studio/common/ai/session-events';
import { resolveActiveSiteFromEntries } from '@studio/common/ai/sessions/active-site';
import {
	isStudioCustomEntryOfType,
	type StudioCustomEntryDataMap,
	type StudioCustomEntryType,
} from '@studio/common/ai/sessions/entry-types';
import { createHydratedAiSession, listHydratedAiSessions } from '@studio/common/ai/sessions/manage';
import { loadAiSession } from '@studio/common/ai/sessions/store';
import { expandSkillCommandPrompt, getAiSkillCommands } from '@studio/common/ai/slash-commands';
import { getAiTracksIdentity } from '@studio/common/ai/tracks-identity';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import { getSessionsDirectory } from '@studio/common/lib/well-known-paths';
import {
	getAvailableAiProviders,
	isAiProviderReady,
	resolveAiEnvironment,
	resolveInitialAiProvider,
} from 'cli/ai/auth';
import { closeSharedBrowser } from 'cli/ai/browser-utils';
import { DEFAULT_AI_PROVIDER, type AiProviderId } from 'cli/ai/providers';
import { toSessionUpdates } from 'cli/ai/runtimes/acp/events';
import { buildQuestionSchema, readQuestionAnswers } from 'cli/ai/runtimes/acp/questions';
import { runStudioAgentTurn, type StudioAgentTurnHandle } from 'cli/ai/runtimes/pi';
import { openStudioSession } from 'cli/ai/sessions/pi-session';
import { findSiteByFolder, findSiteById } from 'cli/lib/cli-config/sites';
import { disconnectFromDaemon } from 'cli/lib/daemon-client';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { isSiteRunning } from 'cli/lib/site-utils';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import type { AskUserQuestion, SiteInfo } from 'cli/ai/types';

const PROVIDER_CONFIG_ID = 'provider';
const MODEL_CONFIG_ID = 'model';

interface AcpSession {
	sm: SessionManager;
	provider: AiProviderId;
	model: AiModelId;
	activeSite: SiteInfo | null;
	turn: StudioAgentTurnHandle | null;
	cancellation: AbortController | null;
	cancelled: boolean;
}

type TurnStatus = 'success' | 'error' | 'interrupted';

function appendStudioEntry< T extends StudioCustomEntryType >(
	sm: SessionManager,
	customType: T,
	data: StudioCustomEntryDataMap[ T ]
): void {
	sm.appendCustomEntry( customType, data );
}

async function buildConfigOptions( session: AcpSession ): Promise< SessionConfigOption[] > {
	const providers = await getAvailableAiProviders();
	return [
		{
			id: PROVIDER_CONFIG_ID,
			name: 'Provider',
			type: 'select',
			currentValue: session.provider,
			options: providers.map( ( provider ) => ( {
				value: provider,
				name: AI_PROVIDER_LABELS[ provider ],
			} ) ),
		},
		{
			id: MODEL_CONFIG_ID,
			name: 'Model',
			category: 'model',
			type: 'select',
			currentValue: session.model,
			options: getAiProviderModels( session.provider ).map( ( model ) => ( {
				value: model.id,
				name: getAiModelLabel( model.id ),
			} ) ),
		},
	];
}

// Images become multimodal input; text and embedded text resources join the
// prompt. Resource links are passed as references the agent reads with its
// file tools, the same way attached files are in the Studio apps.
export function readPrompt( blocks: ContentBlock[] ): { text: string; images: StudioChatImage[] } {
	const parts: string[] = [];
	const images: StudioChatImage[] = [];
	for ( const block of blocks ) {
		if ( block.type === 'text' ) {
			parts.push( block.text );
		} else if ( block.type === 'image' && isStudioChatImageMimeType( block.mimeType ) ) {
			images.push( {
				id: `acp-image-${ images.length + 1 }`,
				name: `image-${ images.length + 1 }`,
				mimeType: block.mimeType,
				size: 0,
				dataBase64: block.data,
			} );
		} else if ( block.type === 'resource_link' ) {
			parts.push( `[${ block.name }](${ block.uri })` );
		} else if ( block.type === 'resource' && 'text' in block.resource ) {
			parts.push( `<file uri="${ block.resource.uri }">\n${ block.resource.text }\n</file>` );
		}
	}
	return { text: parts.join( '\n\n' ), images: validateStudioChatImages( images ) };
}

// The site a session runs against: the last one it selected, or the local
// site whose folder the client opened the session in.
async function resolveSessionSite( sm: SessionManager, cwd: string ): Promise< SiteInfo | null > {
	const recorded = resolveActiveSiteFromEntries( sm.getEntries() );
	if ( recorded ) {
		return { ...recorded, running: false };
	}
	const site = await findSiteByFolder( cwd );
	if ( ! site ) {
		return null;
	}
	appendStudioEntry( sm, 'studio.site_selected', {
		siteName: site.name,
		sitePath: site.path,
		siteId: site.id,
	} );
	return { id: site.id, name: site.name, path: site.path, running: false };
}

// The stored running flag goes stale between turns; ask the daemon, as
// `studio code` does before every prompt.
async function refreshSiteState( site: SiteInfo | null ): Promise< void > {
	if ( ! site || site.remote ) {
		return;
	}
	const siteData = site.id ? await findSiteById( site.id ) : await findSiteByFolder( site.path );
	if ( siteData ) {
		site.id = siteData.id;
		site.name = siteData.name;
		site.path = siteData.path;
		site.running = await isSiteRunning( siteData );
	} else {
		site.running = false;
	}
	await disconnectFromDaemon();
}

async function resolveSessionChoice(
	sm: SessionManager
): Promise< { provider: AiProviderId; model: AiModelId } > {
	const entries = sm.getEntries();
	const pinned = resolveSessionProvider( entries );
	const provider =
		pinned && ( await isAiProviderReady( pinned ) ) ? pinned : await resolveInitialAiProvider();
	const recorded = readRecordedSessionModel( entries );
	const model =
		recorded && providerServesModel( provider, recorded )
			? recorded
			: getAiProviderDefaultModel( provider );
	return { provider, model };
}

async function isAnyProviderReady(): Promise< boolean > {
	for ( const provider of await getAvailableAiProviders() ) {
		if ( await isAiProviderReady( provider ) ) {
			return true;
		}
	}
	return false;
}

function sendUpdate(
	client: AgentContext,
	sessionId: string,
	update: SessionUpdate
): Promise< void > {
	// A client that went away can't take updates; the turn still finishes and
	// is saved to the session.
	return client.notify( 'session/update', { sessionId, update } ).catch( () => undefined );
}

async function replayHistory( client: AgentContext, sm: SessionManager ): Promise< void > {
	const sessionId = sm.getSessionId();
	for ( const entry of sm.getEntries() ) {
		if ( isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
			if ( entry.data?.source === 'prompt' && entry.data.text ) {
				await sendUpdate( client, sessionId, {
					sessionUpdate: 'user_message_chunk',
					content: { type: 'text', text: entry.data.text },
				} );
			}
			continue;
		}
		if ( entry.type !== 'message' || entry.message.role !== 'assistant' ) {
			continue;
		}
		for ( const block of entry.message.content ) {
			if ( block.type === 'text' && block.text ) {
				await sendUpdate( client, sessionId, {
					sessionUpdate: 'agent_message_chunk',
					content: { type: 'text', text: block.text },
				} );
			}
		}
	}
}

/**
 * Serves the Studio Code agent over the Agent Client Protocol on stdio, so
 * ACP clients (Zed, JetBrains, T3 Code, …) run it as one of their agents.
 *
 * Each ACP session is a regular Studio Code session: it is saved in the same
 * place, shows up in `studio code sessions list` and the Studio apps, and can
 * be resumed from any of them. No Studio UI is attached, so the runtime leaves
 * the UI-only tools out, as it does for `studio code` in a terminal.
 */
export async function startAcpStdioServer(): Promise< void > {
	const sessions = new Map< string, AcpSession >();
	let clientCapabilities: ClientCapabilities = {};

	// stdout carries the protocol; anything the agent's tools print goes to stderr.
	console.log = console.error;
	console.info = console.error;

	async function openSession(
		client: AgentContext,
		sm: SessionManager,
		cwd: string
	): Promise< SessionConfigOption[] > {
		const { provider, model } = await resolveSessionChoice( sm );
		const session: AcpSession = {
			sm,
			provider,
			model,
			activeSite: await resolveSessionSite( sm, cwd ),
			turn: null,
			cancellation: null,
			cancelled: false,
		};
		sessions.set( sm.getSessionId(), session );
		// Sent after the response so the client already knows the session.
		setImmediate( () => {
			void sendUpdate( client, sm.getSessionId(), {
				sessionUpdate: 'available_commands_update',
				availableCommands: getAiSkillCommands().map( ( command ) => ( {
					name: command.name,
					description: command.description,
				} ) ),
			} );
		} );
		return buildConfigOptions( session );
	}

	function requireSession( sessionId: string ): AcpSession {
		const session = sessions.get( sessionId );
		if ( ! session ) {
			throw RequestError.invalidParams( { sessionId }, 'Unknown session' );
		}
		return session;
	}

	// AskUserQuestion becomes an ACP form; Stop withdraws a form still open.
	async function askUser(
		client: AgentContext,
		sessionId: string,
		questions: AskUserQuestion[],
		signal: AbortSignal
	): Promise< Record< string, string > > {
		const response = await client.request(
			'elicitation/create',
			{
				mode: 'form',
				sessionId,
				message: questions.map( ( question ) => question.question ).join( '\n' ),
				requestedSchema: buildQuestionSchema( questions ),
			},
			{ cancellationSignal: signal }
		);
		return readQuestionAnswers( questions, response );
	}

	const app = agent( { name: 'studio' } )
		.onRequest( 'initialize', async ( { params } ) => {
			clientCapabilities = params.clientCapabilities ?? {};
			return {
				protocolVersion: PROTOCOL_VERSION,
				agentInfo: {
					name: 'studio',
					title: 'WordPress Studio',
					version: __STUDIO_CLI_VERSION__,
				},
				agentCapabilities: {
					loadSession: true,
					promptCapabilities: { image: true, embeddedContext: true },
					sessionCapabilities: { list: {} },
				},
				authMethods: [
					clientCapabilities.auth?.terminal
						? {
								id: 'studio-login',
								name: 'Log in to WordPress.com',
								description: 'Connects Studio to your WordPress.com account.',
								type: 'terminal' as const,
								// Appended to this agent's own command (`studio code acp`).
								args: [ '--login' ],
						  }
						: {
								id: 'studio-login',
								name: 'Log in to WordPress.com',
								description: 'Run `studio auth login` in a terminal.',
						  },
				],
			};
		} )
		.onRequest( 'authenticate', async () => {
			if ( ! ( await isAiProviderReady( DEFAULT_AI_PROVIDER ) ) ) {
				throw RequestError.authRequired(
					undefined,
					'run `studio auth login` in a terminal, then try again'
				);
			}
			return {};
		} )
		.onRequest( 'session/new', async ( { params, client } ) => {
			if ( ! ( await isAnyProviderReady() ) ) {
				throw RequestError.authRequired();
			}
			// Written up front, as the Studio apps do, so the session can be listed
			// and loaded before its first reply.
			const site = await findSiteByFolder( params.cwd );
			const summary = await createHydratedAiSession( getSessionsDirectory(), {
				site: site ? { id: site.id, name: site.name, path: site.path } : undefined,
			} );
			const sm = await openStudioSession( summary.filePath );
			const configOptions = await openSession( client, sm, params.cwd );
			void recordTracksEvent( TRACKS_EVENTS.CODE_SESSION_CREATED, {
				...getTracksOrigin(),
				...getAiTracksIdentity( sm.getSessionId() ),
				has_site: Boolean( sessions.get( sm.getSessionId() )?.activeSite ),
			} ).catch( () => undefined );
			return { sessionId: sm.getSessionId(), configOptions };
		} )
		.onRequest( 'session/load', async ( { params, client } ) => {
			let filePath: string;
			try {
				( { filePath } = (
					await loadAiSession( getSessionsDirectory(), params.sessionId )
				).summary );
			} catch {
				throw RequestError.invalidParams( { sessionId: params.sessionId }, 'Session not found' );
			}
			const sm = await openStudioSession( filePath );
			const configOptions = await openSession( client, sm, params.cwd );
			await replayHistory( client, sm );
			return { configOptions };
		} )
		.onRequest( 'session/list', async ( { params } ) => {
			const summaries = await listHydratedAiSessions( getSessionsDirectory() );
			const listed: SessionInfo[] = summaries
				.filter( ( summary ) => ! summary.archived )
				.filter(
					( summary ) =>
						! params.cwd ||
						! summary.ownerSitePath ||
						arePathsEqual( summary.ownerSitePath, params.cwd )
				)
				.map( ( summary ) => ( {
					sessionId: summary.id,
					cwd: summary.ownerSitePath ?? STUDIO_SITES_ROOT,
					title: summary.title ?? summary.firstPrompt ?? null,
					updatedAt: summary.updatedAt,
				} ) );
			return { sessions: listed };
		} )
		.onRequest( 'session/set_config_option', async ( { params } ) => {
			const session = requireSession( params.sessionId );
			const value = String( params.value );
			if ( params.configId === PROVIDER_CONFIG_ID ) {
				if ( ! isAiProviderId( value ) ) {
					throw RequestError.invalidParams( { value }, 'Unknown provider' );
				}
				session.provider = value;
				if ( ! providerServesModel( value, session.model ) ) {
					session.model = getAiProviderDefaultModel( value );
				}
				appendStudioEntry( session.sm, 'studio.session_context', {
					provider: session.provider,
					model: session.model,
				} );
			} else if ( params.configId === MODEL_CONFIG_ID ) {
				if ( ! isAiModelId( value ) || ! providerServesModel( session.provider, value ) ) {
					throw RequestError.invalidParams( { value }, 'Model not served by this provider' );
				}
				session.model = value;
				appendStudioEntry( session.sm, 'studio.session_context', { model: value } );
			} else {
				throw RequestError.invalidParams( { configId: params.configId }, 'Unknown option' );
			}
			return { configOptions: await buildConfigOptions( session ) };
		} )
		.onRequest( 'session/prompt', async ( { params, client } ) => {
			const session = requireSession( params.sessionId );
			if ( session.turn ) {
				throw RequestError.invalidRequest( undefined, 'A prompt is already running' );
			}
			if ( ! ( await isAiProviderReady( session.provider ) ) ) {
				throw RequestError.authRequired();
			}
			const { text, images } = readPrompt( params.prompt );
			await refreshSiteState( session.activeSite );
			const env = await resolveAiEnvironment( session.provider, {
				sessionId: params.sessionId,
			} );
			appendStudioEntry( session.sm, 'studio.session_context', { model: session.model } );
			appendStudioEntry( session.sm, 'studio.user_prompt', {
				text,
				source: 'prompt',
				sitePath: session.activeSite?.path,
			} );

			session.cancelled = false;
			const cancellation = new AbortController();
			session.cancellation = cancellation;
			// Updates go out in order, and all before the prompt's response.
			let updates = Promise.resolve();
			const outcome: { status: TurnStatus; failure?: string } = { status: 'interrupted' };
			session.turn = runStudioAgentTurn( {
				prompt: expandSkillCommandPrompt( text ),
				images,
				env,
				model: session.model,
				session: session.sm,
				activeSite: session.activeSite,
				// Clients without forms can't answer, so the agent isn't given the tool.
				onAskUser: clientCapabilities.elicitation?.form
					? ( questions ) => askUser( client, params.sessionId, questions, cancellation.signal )
					: undefined,
				onEvent: ( event ) => {
					for ( const update of toSessionUpdates( event ) ) {
						updates = updates.then( () => sendUpdate( client, params.sessionId, update ) );
					}
					if ( event.type !== 'agent_end' || event.willRetry ) {
						return;
					}
					const result = getAgentEndTurnResult( event );
					outcome.status = result.interrupted
						? 'interrupted'
						: result.success
						? 'success'
						: 'error';
					outcome.failure = getAgentEndFailure( event )?.message || undefined;
				},
			} );
			try {
				await session.turn.result;
				await updates;
			} finally {
				session.turn = null;
				session.cancellation = null;
				appendStudioEntry( session.sm, 'studio.turn_closed', {
					status: outcome.status,
					...( outcome.status === 'error' && outcome.failure
						? { errorMessage: outcome.failure }
						: {} ),
				} );
			}
			if ( session.cancelled || outcome.status === 'interrupted' ) {
				return { stopReason: 'cancelled' };
			}
			if ( outcome.status === 'error' ) {
				throw RequestError.internalError( undefined, outcome.failure || 'the agent failed' );
			}
			return { stopReason: 'end_turn' };
		} )
		.onNotification( 'session/cancel', async ( { params } ) => {
			const session = sessions.get( params.sessionId );
			if ( session?.turn ) {
				session.cancelled = true;
				session.cancellation?.abort();
				await session.turn.interrupt();
			}
		} );

	const connection = app.connect(
		ndJsonStream(
			Writable.toWeb( process.stdout ) as WritableStream< Uint8Array >,
			Readable.toWeb( process.stdin ) as ReadableStream< Uint8Array >
		)
	);

	const shutdown = async () => {
		await Promise.all( [ ...sessions.values() ].map( ( session ) => session.turn?.interrupt() ) );
		await closeSharedBrowser();
		process.exit( 0 );
	};
	process.on( 'SIGINT', shutdown );
	process.on( 'SIGTERM', shutdown );

	await connection.closed;
	await shutdown();
}
