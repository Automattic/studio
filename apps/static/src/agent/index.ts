import { createBrowserAgent, compactionSummaryMessage } from '@studio/agent/browser';
import { buildChatAttachmentSummaries } from '@studio/agent/protocol/chat-attachments';
import { getAiModelFamily, type AiModelId } from '@studio/agent/protocol/models';
import {
	DEFAULT_AI_PROVIDER,
	resolveSessionModelForProvider,
	resolveSessionProvider,
	type AiProviderId,
	type AiSettings,
} from '@studio/agent/protocol/providers';
import { pickLiveSite } from '@studio/agent/protocol/sessions/effective-site';
import { isStudioCustomEntryOfType } from '@studio/agent/protocol/sessions/entry-types';
import {
	canUsePaidAiModels,
	fetchStudioAssistantQuota,
} from '@studio/common/lib/studio-assistant-quota';
import { __ } from '@wordpress/i18n';
import { getSiteUrl } from '../playground';
import { kvGet, kvSet } from '../store';
import { createStaticAgentHost } from './host';
import { StaticSessions } from './sessions';
import type { StaticSiteRecord, StaticSites } from '../sites';
import type {
	ActiveAgentRun,
	AiSessionMetadata,
	AiSessionPlacementUpdatedEvent,
	AiSessionSummary,
	LoadedAiSession,
	SessionEntry,
	StudioChatFileAttachment,
	StudioChatImage,
	StudioVisualAnnotationSummary,
} from '../types';
import type { WpcomAuth } from '../wpcom-auth';
import type { WpcomServices } from '../wpcom-services';
import type { AskUserQuestion, Message, SiteInfo, StudioAgentHost } from '@studio/agent/browser';
import type { AgentEvent, AgentRunEvent } from '@studio/agent/protocol/agent-events';
import type { StudioChatArtifactData } from '@studio/agent/protocol/chat-artifacts';
import type { TurnStatus } from '@studio/agent/protocol/sessions/types';

const AI_SETTINGS_KEY = 'ai-settings';
export const AGENT_INSTRUCTIONS_KEY = 'agent-instructions';
export const AGENT_INSTRUCTIONS_ENABLED_KEY = 'agent-instructions-enabled';

interface StoredAiSettings {
	provider: AiProviderId;
	anthropicApiKey?: string;
}

interface Run {
	runId: string;
	sessionId: string;
	startedAt: number;
	interrupt?: () => void;
	interrupted: boolean;
	pendingQuestions: AskUserQuestion[];
	resolveAnswers?: ( answers: Record< string, string > ) => void;
}

type NewEntry = Omit< SessionEntry, 'id' | 'parentId' | 'timestamp' >;

function nowIso() {
	return new Date().toISOString();
}

// The model's history: everything since the latest compaction, after its summary.
function historyFromEntries( entries: SessionEntry[] ): Message[] {
	const messagesOf = ( list: SessionEntry[] ) =>
		list.flatMap( ( entry ) => ( entry.type === 'message' ? [ entry.message as Message ] : [] ) );
	const index = entries.map( ( entry ) => entry.type ).lastIndexOf( 'compaction' );
	if ( index < 0 ) {
		return messagesOf( entries );
	}
	const compaction = entries[ index ] as SessionEntry & {
		summary: string;
		firstKeptEntryId: string;
	};
	const firstKept = entries.findIndex( ( entry ) => entry.id === compaction.firstKeptEntryId );
	return [
		compactionSummaryMessage( compaction.summary ),
		...messagesOf( entries.slice( firstKept >= 0 ? firstKept : index + 1 ) ),
	];
}

// A run cut short (the tab closed mid-tool) leaves tool calls without results,
// which model APIs reject; answer them as interrupted.
function closeOpenToolCalls( messages: Message[] ): Message[] {
	const answered = new Set(
		messages.flatMap( ( message ) =>
			message.role === 'toolResult' ? [ message.toolCallId ] : []
		)
	);
	return messages.flatMap( ( message ): Message[] => {
		if ( message.role !== 'assistant' ) {
			return [ message ];
		}
		const open = message.content.filter(
			( block ) => block.type === 'toolCall' && ! answered.has( block.id )
		);
		return [
			message,
			...open.map( ( block ) => ( {
				role: 'toolResult' as const,
				toolCallId: block.type === 'toolCall' ? block.id : '',
				toolName: block.type === 'toolCall' ? block.name : '',
				content: [ { type: 'text' as const, text: 'Interrupted before the tool finished.' } ],
				isError: true,
				timestamp: message.timestamp,
			} ) ),
		];
	} );
}

/**
 * Studio Code in the page. The agent (`createBrowserAgent`) runs each turn; this
 * keeps what the CLI and the apps around it keep elsewhere: the conversations,
 * in the same entries the CLI writes, the runs and their events for the chat UI,
 * and the AI settings.
 */
export class StaticAgentRuns {
	private readonly sessions = new StaticSessions();
	private readonly runs = new Map< string, Run >();
	private readonly listeners = new Set< ( event: AgentRunEvent ) => void >();
	private readonly placementListeners = new Set<
		( event: AiSessionPlacementUpdatedEvent ) => void
	>();
	private readonly host: StudioAgentHost;

	constructor(
		private readonly deps: {
			sites: StaticSites;
			auth: WpcomAuth;
			wpcom: WpcomServices;
			readAttachment( path: string ): File | undefined;
			download( data: BlobPart, filename: string, type: string ): void;
		}
	) {
		this.host = createStaticAgentHost( deps );
	}

	getSessions(): Promise< AiSessionSummary[] > {
		return this.sessions.list();
	}

	getSession( sessionId: string ): Promise< LoadedAiSession > {
		return this.sessions.load( sessionId );
	}

	updateSessionMetadata( sessionId: string, patch: AiSessionMetadata ) {
		return this.sessions.updateMetadata( sessionId, patch );
	}

	async createSession( siteId?: string ): Promise< AiSessionSummary > {
		const site = siteId ? await this.deps.sites.get( siteId ) : undefined;
		const summary = await this.sessions.create(
			site ? { siteId: site.id, sitePath: site.path, siteName: site.name } : undefined
		);
		if ( site ) {
			await this.recordSiteSelected( summary.id, site );
		}
		return summary;
	}

	async getActiveRuns(): Promise< ActiveAgentRun[] > {
		return [ ...this.runs.values() ].map( ( run ) => ( {
			runId: run.runId,
			sessionId: run.sessionId,
			startedAt: run.startedAt,
			phase: run.interrupted ? 'interrupting' : 'running',
			...( run.pendingQuestions.length ? { pendingQuestions: run.pendingQuestions } : {} ),
		} ) );
	}

	async setSessionModel( sessionId: string, model: AiModelId ) {
		await this.sessions.append( sessionId, {
			type: 'model_change',
			provider: getAiModelFamily( model ),
			modelId: model,
		} as NewEntry );
	}

	async setSessionProvider( sessionId: string, provider: AiProviderId, model: AiModelId ) {
		await this.sessions.appendCustom( sessionId, 'studio.session_context', { provider, model } );
	}

	// Points the chat's next turn at its site, locally or on its connected
	// WordPress.com site, as the same `studio.site_selected` entry the agent writes.
	async setSessionEnvironment( sessionId: string, environment: 'local' | 'live' ) {
		const ownerId = ( await this.sessions.read( sessionId ) )?.owner?.siteId;
		const site = ownerId && ( await this.deps.sites.get( ownerId ).catch( () => undefined ) );
		if ( ! site ) {
			throw new Error( __( 'This chat is not attached to a site.' ) );
		}
		if ( environment === 'local' ) {
			await this.recordSiteSelected( sessionId, site );
			return;
		}
		const live = pickLiveSite( await this.deps.wpcom.getConnectedSites( site.id ) );
		if ( ! live ) {
			throw new Error( __( 'This site is not connected to a WordPress.com site.' ) );
		}
		await this.sessions.appendCustom( sessionId, 'studio.site_selected', {
			siteName: site.name,
			sitePath: site.path,
			siteId: site.id,
			remote: true,
			url: live.url,
			wpcomSiteId: live.id,
		} );
	}

	async interrupt( runId: string ) {
		const run = this.runs.get( runId );
		if ( ! run ) {
			return;
		}
		run.interrupted = true;
		this.emit( run, { type: 'run.interrupting', timestamp: nowIso() } );
		run.resolveAnswers?.( {} );
		run.interrupt?.();
	}

	async answer( runId: string, answers: Record< string, string > ) {
		this.runs.get( runId )?.resolveAnswers?.( answers );
	}

	onEvent( listener: ( event: AgentRunEvent ) => void ) {
		this.listeners.add( listener );
		return () => this.listeners.delete( listener );
	}

	onPlacementUpdated( listener: ( event: AiSessionPlacementUpdatedEvent ) => void ) {
		this.placementListeners.add( listener );
		return () => this.placementListeners.delete( listener );
	}

	private async readAiSettings(): Promise< StoredAiSettings > {
		return (
			( await kvGet< StoredAiSettings >( AI_SETTINGS_KEY ) ) ?? { provider: DEFAULT_AI_PROVIDER }
		);
	}

	async getAiSettings(): Promise< AiSettings > {
		const settings = await this.readAiSettings();
		const key = settings.anthropicApiKey;
		return {
			provider: settings.provider,
			hasAnthropicApiKey: !! key,
			anthropicApiKeyPreview: key ? `${ key.slice( 0, 7 ) }…${ key.slice( -4 ) }` : null,
		};
	}

	async saveAnthropicApiKey( key: string | null ): Promise< AiSettings > {
		const settings = await this.readAiSettings();
		await kvSet< StoredAiSettings >( AI_SETTINGS_KEY, {
			provider: key ? settings.provider : DEFAULT_AI_PROVIDER,
			...( key ? { anthropicApiKey: key } : {} ),
		} );
		return this.getAiSettings();
	}

	async setAiProvider( provider: AiProviderId ): Promise< AiSettings > {
		await kvSet( AI_SETTINGS_KEY, { ...( await this.readAiSettings() ), provider } );
		return this.getAiSettings();
	}

	private emit( run: Run, event: AgentEvent ) {
		const payload = { runId: run.runId, sessionId: run.sessionId, event };
		this.listeners.forEach( ( listener ) => listener( payload ) );
	}

	private async recordSiteSelected( sessionId: string, site: StaticSiteRecord ) {
		await this.sessions.appendCustom( sessionId, 'studio.site_selected', {
			siteName: site.name,
			sitePath: site.path,
			siteId: site.id,
			url: getSiteUrl( site.scope ),
		} );
	}

	// The site the chat works on: the local site last selected, or its connected
	// WordPress.com site when switched to Live and still connected.
	private async activeSite( sessionId: string ): Promise< SiteInfo | undefined > {
		const session = await this.sessions.read( sessionId );
		const selected = session?.entries
			.slice()
			.reverse()
			.find( ( entry ) => isStudioCustomEntryOfType( entry, 'studio.site_selected' ) );
		const data =
			selected && isStudioCustomEntryOfType( selected, 'studio.site_selected' )
				? selected.data
				: undefined;
		if ( data?.remote && data.wpcomSiteId && data.url && data.siteId ) {
			const connected = await this.deps.wpcom.getConnectedSites( data.siteId ).catch( () => [] );
			if ( connected.some( ( site ) => site.id === data.wpcomSiteId ) ) {
				return {
					name: data.siteName,
					path: '',
					running: true,
					remote: true,
					url: data.url,
					wpcomSiteId: data.wpcomSiteId,
				};
			}
		}
		const siteId = data?.siteId ?? session?.owner?.siteId;
		const site = siteId ? await this.deps.sites.get( siteId ).catch( () => undefined ) : undefined;
		return (
			site && {
				id: site.id,
				name: site.name,
				path: site.path,
				running: this.deps.sites.runtimes.isRunning( site.id ),
				url: getSiteUrl( site.scope ),
			}
		);
	}

	async continueSession(
		sessionId: string,
		prompt: string,
		options: {
			displayMessage?: string;
			images?: StudioChatImage[];
			files?: StudioChatFileAttachment[];
			visualAnnotations?: StudioVisualAnnotationSummary[];
		} = {}
	): Promise< { runId: string } > {
		if ( [ ...this.runs.values() ].some( ( run ) => run.sessionId === sessionId ) ) {
			throw new Error( __( 'This conversation is already running.' ) );
		}
		const run: Run = {
			runId: crypto.randomUUID(),
			sessionId,
			startedAt: Date.now(),
			interrupted: false,
			pendingQuestions: [],
		};
		this.runs.set( run.runId, run );
		// The caller subscribes with the run id it gets back, so events start
		// after it has it.
		setTimeout( () => void this.execute( run, prompt, options ), 0 );
		return { runId: run.runId };
	}

	private async execute(
		run: Run,
		prompt: string,
		options: {
			displayMessage?: string;
			images?: StudioChatImage[];
			files?: StudioChatFileAttachment[];
			visualAnnotations?: StudioVisualAnnotationSummary[];
		}
	) {
		const { sessionId } = run;
		this.emit( run, { type: 'run.started', timestamp: nowIso() } );
		this.emit( run, { type: 'turn.started', timestamp: nowIso() } );
		let status: TurnStatus = 'success';
		let errorMessage: string | undefined;
		try {
			const session = await this.sessions.read( sessionId );
			if ( ! session ) {
				throw new Error( `Session ${ sessionId } not found` );
			}
			const settings = await this.readAiSettings();
			const token = await this.deps.auth.token();
			let provider = resolveSessionProvider( session.entries ) ?? settings.provider;
			if ( provider === 'anthropic-api-key' && ! settings.anthropicApiKey ) {
				provider = DEFAULT_AI_PROVIDER;
			}
			if ( provider === 'wpcom' && ! token ) {
				throw new Error(
					__(
						'Sign in to WordPress.com, or add an Anthropic API key in Settings, to use Studio Code.'
					)
				);
			}
			const quota =
				provider === 'wpcom' && token ? await fetchStudioAssistantQuota( token.accessToken ) : null;
			const model = resolveSessionModelForProvider( session.entries, provider, {
				canUsePaidModels: canUsePaidAiModels( quota, token?.email ),
			} );
			const activeSite = await this.activeSite( sessionId );

			await this.sessions.appendCustom( sessionId, 'studio.session_context', { model } );
			await this.sessions.appendCustom( sessionId, 'studio.user_prompt', {
				text: options.displayMessage ?? prompt,
				source: 'prompt',
				sitePath: activeSite?.remote ? undefined : activeSite?.path,
				attachments: buildChatAttachmentSummaries( options.images ?? [], options.files ?? [] ),
				visualAnnotations: options.visualAnnotations,
			} );

			const instructionsEnabled =
				( await kvGet< boolean >( AGENT_INSTRUCTIONS_ENABLED_KEY ) ) ?? true;
			const agent = createBrowserAgent( {
				host: {
					...this.host,
					ui: {
						showArtifact: async ( artifact: StudioChatArtifactData ) => {
							await this.sessions.appendCustom( sessionId, 'studio.chat_artifact', artifact );
							this.emit( run, { type: 'chat.artifact', timestamp: nowIso(), artifact } );
						},
						reloadPreview: () => this.emit( run, { type: 'preview.reload', timestamp: nowIso() } ),
					},
					selectSite: async ( selected ) => {
						const record = selected.id && ( await this.deps.sites.get( selected.id ) );
						if ( record ) {
							await this.selectSite( sessionId, record );
						}
					},
				},
			} );
			const turn = agent.runTurn( {
				sessionId,
				prompt,
				images: options.images,
				files: options.files,
				history: closeOpenToolCalls( historyFromEntries( session.entries ) ),
				model,
				credentials: {
					wpcomToken: token?.accessToken,
					anthropicApiKey: settings.anthropicApiKey,
				},
				activeSite,
				userInstructions: instructionsEnabled
					? await kvGet< string >( AGENT_INSTRUCTIONS_KEY )
					: undefined,
				onAskUser: ( questions ) => this.askUser( run, questions ),
				onEvent: ( event ) =>
					this.emit( run, { type: 'message', timestamp: nowIso(), message: event as never } ),
				onMessage: async ( message ) => {
					await this.sessions.append( sessionId, { type: 'message', message } as NewEntry );
				},
				onCompaction: async ( compaction, kept ) => {
					const messages = ( await this.sessions.read( sessionId ) )?.entries.filter(
						( entry ) => entry.type === 'message'
					);
					const firstKept = messages?.[ messages.length - kept ];
					if ( firstKept ) {
						await this.sessions.append( sessionId, {
							type: 'compaction',
							...compaction,
							firstKeptEntryId: firstKept.id,
						} as NewEntry );
					}
				},
			} );
			run.interrupt = turn.interrupt;
			const { failure } = await turn.result;
			if ( run.interrupted ) {
				status = 'interrupted';
			} else if ( failure !== undefined ) {
				status = 'error';
				errorMessage = failure || undefined;
			}
		} catch ( error ) {
			status = run.interrupted ? 'interrupted' : 'error';
			errorMessage = error instanceof Error ? error.message : String( error );
			if ( status === 'error' ) {
				this.emit( run, { type: 'error', timestamp: nowIso(), message: errorMessage } );
			}
		} finally {
			await this.sessions
				.appendCustom( sessionId, 'studio.turn_closed', {
					status,
					...( status === 'error' && errorMessage ? { errorMessage } : {} ),
				} )
				.catch( () => undefined );
			this.emit( run, {
				type: 'turn.completed',
				timestamp: nowIso(),
				sessionId,
				status: status === 'interrupted' ? 'error' : status,
			} );
			this.runs.delete( run.runId );
			this.emit(
				run,
				status === 'interrupted'
					? { type: 'run.interrupted', timestamp: nowIso() }
					: {
							type: 'run.exited',
							timestamp: nowIso(),
							status: status === 'success' ? 'success' : 'error',
							code: status === 'success' ? 0 : 1,
					  }
			);
		}
	}

	// Makes a site the conversation's: its selected site, and its owner when it
	// has none yet.
	private async selectSite( sessionId: string, site: StaticSiteRecord ) {
		await this.recordSiteSelected( sessionId, site );
		const stored = await this.sessions.read( sessionId );
		if ( ! stored?.owner ) {
			const placement = { siteId: site.id, sitePath: site.path, siteName: site.name };
			await this.sessions.setOwner( sessionId, placement );
			this.placementListeners.forEach( ( listener ) =>
				listener( { sessionId, placement: { kind: 'site', ...placement } } )
			);
		}
	}

	private async askUser(
		run: Run,
		questions: AskUserQuestion[]
	): Promise< Record< string, string > > {
		for ( const question of questions ) {
			await this.sessions.appendCustom( run.sessionId, 'studio.agent_question', question );
		}
		run.pendingQuestions = questions;
		this.emit( run, { type: 'question.asked', timestamp: nowIso(), questions } );
		const answers = await new Promise< Record< string, string > >( ( resolve ) => {
			run.resolveAnswers = resolve;
		} );
		run.pendingQuestions = [];
		run.resolveAnswers = undefined;
		for ( const question of questions ) {
			const answer = answers[ question.question ];
			if ( answer?.trim() ) {
				await this.sessions.appendCustom( run.sessionId, 'studio.user_prompt', {
					text: answer,
					source: 'ask_user',
				} );
			}
		}
		return answers;
	}
}
