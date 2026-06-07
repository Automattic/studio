import { createDefaultDeskSettings } from '@studio/common/lib/desk-settings';
import { DEFAULT_MESSAGE_SEND_SHORTCUT } from '@studio/common/lib/user-settings/message-send-shortcut';
import { buildPreviewUrl } from './preview-blueprint';
import type {
	ActiveAgentRun,
	AiSessionSummary,
	AuthUser,
	Connector,
	DeskConfig,
	DeskSettings,
	FeatureFlags,
	FeaturedBlueprint,
	InstalledApps,
	LoadedAiSession,
	SessionEntry,
	SiteDetails,
	Snapshot,
	StudioUiMode,
	SyncSite,
	UserPreferences,
} from '../../types';
import type { AgentEvent, AgentRunEvent } from '@studio/common/ai/agent-events';
import type { JsonEvent } from '@studio/common/ai/json-events';

export interface SecexConnectorOptions {
	// Full URL of the wpcom Studio Code endpoint, e.g.
	// https://public-api.wordpress.com/wpcom/v2/studio-code/run
	runUrl: string;
	// WordPress.com OAuth Bearer token forwarded to the endpoint (which forwards
	// it into the sandbox as STUDIO_WPCOM_TOKEN for the model proxy).
	token: string;
}

export class SecexUnsupportedError extends Error {
	constructor( operation: string ) {
		super( `"${ operation }" is not available in Studio Web (SecEx).` );
		this.name = 'SecexUnsupportedError';
	}
}

const SESSIONS_KEY = 'studio-secex-sessions';
const CLI_IDS_KEY = 'studio-secex-cli-session-ids';
const ENTRIES_KEY = 'studio-secex-entries';

function nowIso(): string {
	return new Date().toISOString();
}

function readJson< T >( key: string, fallback: T ): T {
	try {
		const raw = window.localStorage.getItem( key );
		return raw ? ( JSON.parse( raw ) as T ) : fallback;
	} catch {
		return fallback;
	}
}

function writeJson( key: string, value: unknown ): void {
	try {
		window.localStorage.setItem( key, JSON.stringify( value ) );
	} catch {
		// Ignore storage failures (private mode, quota).
	}
}

/**
 * Connector that drives the agent directly against the hosted wpcom Studio Code
 * endpoint (`/wpcom/v2/studio-code/run`) — no local `web-server`. The browser is
 * already sandbox-routed, so a same-session `fetch()` reaches the user's SecEx
 * sandbox; the endpoint streams the CLI's NDJSON back as SSE, which we translate
 * into the `AgentRunEvent`s the UI already understands.
 *
 * What the `/run` endpoint does NOT provide is modelled client-side for the PoC:
 * the session list lives in `localStorage`, multi-turn uses the CLI `session_id`
 * surfaced in the stream, and site/preview/sync surfaces are stubbed.
 */
export function createSecexConnector( { runUrl, token }: SecexConnectorOptions ): Connector {
	const agentListeners = new Set< ( event: AgentRunEvent ) => void >();
	const activeRuns = new Map<
		string,
		{ runId: string; sessionId: string; startedAt: number; controller: AbortController }
	>();

	function emit( runId: string, sessionId: string, event: AgentEvent ): void {
		const payload: AgentRunEvent = { runId, sessionId, event };
		agentListeners.forEach( ( listener ) => listener( payload ) );
	}

	function getSessions(): AiSessionSummary[] {
		return readJson< AiSessionSummary[] >( SESSIONS_KEY, [] );
	}
	function putSessions( sessions: AiSessionSummary[] ): void {
		writeJson( SESSIONS_KEY, sessions );
	}
	function patchSession( sessionId: string, patch: Partial< AiSessionSummary > ): AiSessionSummary {
		const sessions = getSessions();
		const index = sessions.findIndex( ( s ) => s.id === sessionId );
		if ( index === -1 ) {
			throw new Error( `Unknown session ${ sessionId }` );
		}
		const updated = { ...sessions[ index ], ...patch, updatedAt: nowIso() };
		sessions[ index ] = updated;
		putSessions( sessions );
		return updated;
	}

	function getCliSessionId( sessionId: string ): string | undefined {
		return readJson< Record< string, string > >( CLI_IDS_KEY, {} )[ sessionId ];
	}
	function setCliSessionId( sessionId: string, cliSessionId: string ): void {
		const map = readJson< Record< string, string > >( CLI_IDS_KEY, {} );
		map[ sessionId ] = cliSessionId;
		writeJson( CLI_IDS_KEY, map );
	}

	// The conversation is persisted client-side so that the run-end refetch of
	// getSession (which use-agent-run fires to swap optimistic entries for
	// "disk-backed" ones) returns the real history instead of wiping it — and so
	// it survives reloads. We accumulate the same SessionEntry shapes the
	// use-agent-run reducer builds from the live stream.
	function getEntries( sessionId: string ): SessionEntry[] {
		return readJson< Record< string, SessionEntry[] > >( ENTRIES_KEY, {} )[ sessionId ] ?? [];
	}
	function appendEntry( sessionId: string, entry: SessionEntry ): void {
		const map = readJson< Record< string, SessionEntry[] > >( ENTRIES_KEY, {} );
		map[ sessionId ] = [ ...( map[ sessionId ] ?? [] ), entry ];
		writeJson( ENTRIES_KEY, map );
	}
	function entryId(): string {
		return Math.random().toString( 36 ).slice( 2, 10 );
	}

	// Stream one /run turn: POST the prompt, parse the SSE frames, translate each
	// `data:` JsonEvent into an AgentRunEvent, and synthesize run lifecycle events.
	async function streamRun(
		runId: string,
		sessionId: string,
		prompt: string,
		controller: AbortController
	): Promise< void > {
		const cliSessionId = getCliSessionId( sessionId );
		let resolvedCliSessionId = cliSessionId;
		let sawError = false;

		try {
			const response = await fetch( runUrl, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${ token }`,
					'X-WPCOM-AI-Feature': 'studio-code',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify( {
					prompt,
					...( cliSessionId ? { session_id: cliSessionId } : {} ),
				} ),
				signal: controller.signal,
			} );

			if ( ! response.ok || ! response.body ) {
				const text = await response.text().catch( () => '' );
				emit( runId, sessionId, {
					type: 'error',
					timestamp: nowIso(),
					message: `studio-code/run failed (${ response.status }): ${ text }`,
				} );
				sawError = true;
			} else {
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';

				const handleFrame = ( frame: string ): void => {
					let eventName = 'message';
					const dataLines: string[] = [];
					for ( const line of frame.split( '\n' ) ) {
						if ( line.startsWith( 'event:' ) ) {
							eventName = line.slice( 6 ).trim();
						} else if ( line.startsWith( 'data:' ) ) {
							dataLines.push( line.slice( 5 ).replace( /^ /, '' ) );
						}
					}
					const dataStr = dataLines.join( '\n' );
					if ( ! dataStr ) {
						return;
					}

					if ( eventName === 'error' ) {
						let message = dataStr;
						try {
							const parsed = JSON.parse( dataStr ) as { message?: string; code?: string };
							message = parsed.message ?? parsed.code ?? dataStr;
						} catch {
							// keep raw
						}
						emit( runId, sessionId, { type: 'error', timestamp: nowIso(), message } );
						sawError = true;
						return;
					}

					if ( eventName === 'session' || eventName === 'done' ) {
						try {
							const parsed = JSON.parse( dataStr ) as { session_id?: string };
							if ( parsed.session_id ) {
								resolvedCliSessionId = parsed.session_id;
							}
						} catch {
							// ignore
						}
						return;
					}

					// eventName === 'data' (or default): the payload is a CLI JsonEvent.
					let json: JsonEvent;
					try {
						json = JSON.parse( dataStr ) as JsonEvent;
					} catch {
						return;
					}

					// The sandbox CLI emits the raw Claude Agent SDK message shape
					// (`message.type` = system/assistant/user/result), while the UI's run
					// reducer (use-agent-run) renders the pi session shape (`message_end`
					// for assistant text/tool calls, `turn_end` for tool results).
					// Translate so the conversation renders; the session id also rides in
					// these messages. Other JsonEvents (progress, turn.*, error) already
					// match the UI's format and pass through unchanged.
					if ( json.type === 'message' ) {
						const inner = json.message as {
							type?: string;
							session_id?: string;
							message?: { role?: string };
						};
						if ( inner?.session_id ) {
							resolvedCliSessionId = inner.session_id;
						}
						const timestamp = json.timestamp ?? nowIso();
						const fullMessage = inner as { message?: unknown };
						if ( inner?.type === 'assistant' && inner.message?.role === 'assistant' ) {
							emit( runId, sessionId, {
								type: 'message',
								timestamp,
								message: { type: 'message_end', message: fullMessage.message },
							} as unknown as AgentEvent );
							appendEntry( sessionId, {
								type: 'message',
								id: entryId(),
								parentId: null,
								timestamp,
								message: fullMessage.message,
							} as unknown as SessionEntry );
						} else if ( inner?.type === 'user' && fullMessage.message ) {
							emit( runId, sessionId, {
								type: 'message',
								timestamp,
								message: { type: 'turn_end', toolResults: [ fullMessage.message ] },
							} as unknown as AgentEvent );
							appendEntry( sessionId, {
								type: 'message',
								id: entryId(),
								parentId: null,
								timestamp,
								message: fullMessage.message,
							} as unknown as SessionEntry );
						}
						// system/result frames carry no renderable entry; run lifecycle is
						// synthesized separately and the endpoint emits its own turn.completed.
						return;
					}

					if ( json.type === 'progress' ) {
						appendEntry( sessionId, {
							type: 'custom',
							id: entryId(),
							parentId: null,
							timestamp: json.timestamp ?? nowIso(),
							customType: 'studio.tool_progress',
							data: { message: json.message },
						} as unknown as SessionEntry );
					}
					emit( runId, sessionId, json as AgentEvent );
				};

				for (;;) {
					const { value, done } = await reader.read();
					if ( done ) {
						break;
					}
					buffer += decoder.decode( value, { stream: true } );
					let sep = buffer.indexOf( '\n\n' );
					while ( sep !== -1 ) {
						handleFrame( buffer.slice( 0, sep ) );
						buffer = buffer.slice( sep + 2 );
						sep = buffer.indexOf( '\n\n' );
					}
				}
				if ( buffer.trim() ) {
					handleFrame( buffer );
				}
			}
		} catch ( error ) {
			if ( ( error as Error ).name !== 'AbortError' ) {
				emit( runId, sessionId, {
					type: 'error',
					timestamp: nowIso(),
					message: ( error as Error ).message || 'studio-code/run stream failed',
				} );
				sawError = true;
			}
		}

		if ( resolvedCliSessionId && resolvedCliSessionId !== cliSessionId ) {
			setCliSessionId( sessionId, resolvedCliSessionId );
		}
		try {
			patchSession( sessionId, {} );
		} catch {
			// Session may have been deleted mid-run.
		}
		emit( runId, sessionId, {
			type: 'run.exited',
			timestamp: nowIso(),
			status: sawError ? 'error' : 'success',
			code: sawError ? 1 : 0,
		} );
	}

	return {
		async init() {
			// No global SSE connection — each run streams over its own fetch.
		},

		// Auth — the PoC carries a pre-provisioned Bearer; no interactive gate.
		requiresAuth: false,
		async isAuthenticated() {
			return Boolean( token );
		},
		async getAuthUser(): Promise< AuthUser | null > {
			return null;
		},
		async authenticate() {
			// No-op.
		},
		async logout() {
			// No-op.
		},
		onAuthStateChanged() {
			return () => {};
		},

		// Sites — the agentic UI is site-centric (chats hang off a site), so expose
		// one synthetic "site" standing for the user's SecEx sandbox. Entering it
		// gives you a chat where the agent can create real WordPress sites inside
		// the sandbox via `site_create`. The /run endpoint doesn't list the actual
		// per-sandbox sites yet, so this single entry is the chat surface.
		async getSites(): Promise< SiteDetails[] > {
			// `url` is a WordPress Playground URL (foreign origin) rendering the site
			// client-side (Telex-style). The dashboard layout detects the Playground
			// origin and uses a bare iframe (PlaygroundPreviewFrame) instead of
			// SitePreview, whose same-origin machinery would OOM-crash on it.
			return [
				{
					id: 'secex-sandbox',
					name: 'Studio Web (SecEx)',
					path: '/home/user/Studio',
					port: 0,
					running: true,
					url: buildPreviewUrl(),
					phpVersion: '',
				},
			];
		},
		async createSite() {
			throw new SecexUnsupportedError( 'createSite' );
		},
		async deleteSite() {
			throw new SecexUnsupportedError( 'deleteSite' );
		},
		async copySite(): Promise< SiteDetails > {
			throw new SecexUnsupportedError( 'copySite' );
		},
		async startSite() {
			// The synthetic sandbox "site" is always considered running.
		},
		async stopSite() {
			// No-op for the synthetic sandbox site.
		},
		async updateSite() {
			throw new SecexUnsupportedError( 'updateSite' );
		},
		async refreshSiteIcon() {
			// No-op.
		},
		async getXdebugEnabledSite(): Promise< SiteDetails | null > {
			return null;
		},
		async exportFullSite(): Promise< string | null > {
			throw new SecexUnsupportedError( 'exportFullSite' );
		},
		async exportDatabase(): Promise< string | null > {
			throw new SecexUnsupportedError( 'exportDatabase' );
		},
		// Site-creation helpers: in Studio Web sites are created by the agent
		// (`site_create`), not the desktop folder-picker form. Return benign values
		// so any UI that probes these doesn't throw; the local-path form isn't the
		// SecEx path.
		async generateProposedSiteName( usedSites ): Promise< string > {
			return usedSites.length ? `My Site ${ usedSites.length + 1 }` : 'My Site';
		},
		async generateProposedSitePath() {
			return { path: '', isEmpty: true, isWordPress: false };
		},
		async selectSiteFolder() {
			return null;
		},
		async comparePaths() {
			return false;
		},
		async getAllCustomDomains(): Promise< string[] > {
			return [];
		},

		// Featured blueprints — public endpoint, identical to the other connectors.
		async getFeaturedBlueprints( locale ) {
			const url = new URL( 'https://public-api.wordpress.com/wpcom/v2/studio-app/blueprints' );
			if ( locale ) {
				url.searchParams.set( 'locale', locale );
			}
			const response = await fetch( url.toString() );
			if ( ! response.ok ) {
				throw new Error( `Failed to fetch blueprints: ${ response.status }` );
			}
			const body = ( await response.json() ) as {
				blueprints?: Array< {
					slug?: string;
					title?: string;
					excerpt?: string;
					image?: string;
					playground_url?: string;
					blueprint?: unknown;
				} >;
			};
			const list: FeaturedBlueprint[] = [];
			for ( const item of body.blueprints ?? [] ) {
				if (
					typeof item.slug !== 'string' ||
					typeof item.title !== 'string' ||
					typeof item.excerpt !== 'string' ||
					typeof item.image !== 'string' ||
					typeof item.playground_url !== 'string' ||
					! item.blueprint ||
					typeof item.blueprint !== 'object'
				) {
					continue;
				}
				list.push( {
					slug: item.slug,
					title: item.title,
					excerpt: item.excerpt,
					image: item.image,
					playgroundUrl: item.playground_url,
					blueprint: item.blueprint as FeaturedBlueprint[ 'blueprint' ],
				} );
			}
			return list;
		},

		async getFilePath() {
			return '';
		},
		async readLocalMediaFile() {
			throw new SecexUnsupportedError( 'readLocalMediaFile' );
		},
		async extractBlueprintBundle() {
			throw new SecexUnsupportedError( 'extractBlueprintBundle' );
		},
		async cleanupBlueprintTempDir() {
			// No-op.
		},
		async importSiteFromBackup(): Promise< SiteDetails > {
			throw new SecexUnsupportedError( 'importSiteFromBackup' );
		},

		// Preview / sync — out of PoC scope.
		async getSnapshots(): Promise< Snapshot[] > {
			return [];
		},
		async publishPreviewSite(): Promise< { url: string } > {
			throw new SecexUnsupportedError( 'publishPreviewSite' );
		},
		async getConnectedWpcomSites(): Promise< SyncSite[] > {
			return [];
		},
		async fetchSyncableWpcomSites(): Promise< SyncSite[] > {
			return [];
		},
		async connectWpcomSite() {
			throw new SecexUnsupportedError( 'connectWpcomSite' );
		},
		async disconnectWpcomSite() {
			throw new SecexUnsupportedError( 'disconnectWpcomSite' );
		},
		onSyncConnectSite() {
			return () => {};
		},
		async pushSiteToLive() {
			throw new SecexUnsupportedError( 'pushSiteToLive' );
		},
		async pullSiteFromLive() {
			throw new SecexUnsupportedError( 'pullSiteFromLive' );
		},
		getPublishCheckoutUrl() {
			return undefined;
		},

		// AI sessions — client-side list; runs stream straight to the endpoint.
		async getSessions(): Promise< AiSessionSummary[] > {
			return getSessions();
		},
		async getSession( sessionId ): Promise< LoadedAiSession > {
			const summary = getSessions().find( ( s ) => s.id === sessionId );
			if ( ! summary ) {
				throw new Error( `Unknown session ${ sessionId }` );
			}
			// The /run endpoint can't re-serve history, so return the conversation
			// we accumulated from the live stream (also survives reloads).
			return { summary, entries: getEntries( sessionId ) };
		},
		async deleteSession( sessionId ) {
			putSessions( getSessions().filter( ( s ) => s.id !== sessionId ) );
			const map = readJson< Record< string, SessionEntry[] > >( ENTRIES_KEY, {} );
			delete map[ sessionId ];
			writeJson( ENTRIES_KEY, map );
		},
		async updateSessionMetadata( sessionId, patch ): Promise< AiSessionSummary > {
			return patchSession( sessionId, patch );
		},
		async createSession(): Promise< AiSessionSummary > {
			const now = nowIso();
			const summary: AiSessionSummary = {
				id: crypto.randomUUID(),
				filePath: '',
				createdAt: now,
				updatedAt: now,
				activeEnvironment: 'local',
				eventCount: 0,
				// Bind to the synthetic sandbox "site" so the agentic session view
				// shows the header + the preview toggle (canTogglePreview needs an
				// ownerSite resolved by ownerSitePath). Matches getSites() above.
				ownerSiteName: 'Studio Web (SecEx)',
				ownerSitePath: '/home/user/Studio',
				selectedSiteName: 'Studio Web (SecEx)',
			};
			putSessions( [ summary, ...getSessions() ] );
			return summary;
		},
		async continueSession( sessionId, prompt, options ): Promise< { runId: string } > {
			const runId = crypto.randomUUID();
			const controller = new AbortController();
			activeRuns.set( runId, { runId, sessionId, startedAt: Date.now(), controller } );

			const existing = getSessions().find( ( s ) => s.id === sessionId );
			patchSession( sessionId, {
				firstPrompt: existing?.firstPrompt ?? ( options?.displayMessage || prompt ),
				eventCount: ( existing?.eventCount ?? 0 ) + 1,
			} );

			// Persist the user's prompt so getSession's run-end refetch keeps it.
			appendEntry( sessionId, {
				type: 'custom',
				id: entryId(),
				parentId: null,
				timestamp: nowIso(),
				customType: 'studio.user_prompt',
				data: { text: options?.displayMessage ?? prompt, source: 'prompt' },
			} as unknown as SessionEntry );

			emit( runId, sessionId, { type: 'run.started', timestamp: nowIso() } );

			void streamRun( runId, sessionId, prompt, controller ).finally( () => {
				activeRuns.delete( runId );
			} );

			return { runId };
		},
		async getActiveAgentRuns(): Promise< ActiveAgentRun[] > {
			return Array.from( activeRuns.values() ).map( ( run ) => ( {
				runId: run.runId,
				sessionId: run.sessionId,
				startedAt: run.startedAt,
				phase: 'running',
			} ) );
		},
		async setSessionModel() {
			// The /run endpoint doesn't take a model override; the sandbox CLI uses
			// its default. No-op for the PoC.
		},
		async interruptAgentRun( runId ) {
			const run = activeRuns.get( runId );
			if ( run ) {
				run.controller.abort();
				activeRuns.delete( runId );
				emit( runId, run.sessionId, { type: 'run.interrupted', timestamp: nowIso() } );
			}
		},
		async answerAgentQuestion() {
			// The one-shot /run stream has no back-channel; runs use --auto-approve.
		},
		async setSessionEnvironment( _sessionId, environment ) {
			return { environment };
		},
		onAgentEvent( listener ) {
			agentListeners.add( listener );
			return () => agentListeners.delete( listener );
		},
		onSessionPlacementUpdated() {
			return () => {};
		},

		// User preferences — browser defaults.
		async getUserPreferences(): Promise< UserPreferences > {
			return {
				editor: null,
				terminal: null,
				colorScheme: 'system',
				messageSendShortcut: DEFAULT_MESSAGE_SEND_SHORTCUT,
				wpAdminOpenTarget: 'default-browser',
				locale: undefined,
			};
		},
		async setUserPreferences() {
			// No-op.
		},
		async getInstalledApps(): Promise< InstalledApps > {
			return {} as InstalledApps;
		},

		// Desks / feature flags — defaults so both UI modes mount cleanly.
		async getFeatureFlags(): Promise< FeatureFlags > {
			return { enableDesksUiSwitch: false };
		},
		async getStudioUiMode(): Promise< StudioUiMode > {
			return 'agentic';
		},
		async setStudioUiMode() {
			// No-op.
		},
		async getDeskSettings(): Promise< DeskSettings > {
			return createDefaultDeskSettings();
		},
		async saveDeskSettings() {
			// No-op.
		},
		async exportDeskConfig(): Promise< string | null > {
			return null;
		},
		async importDeskConfig(): Promise< DeskConfig | null > {
			return null;
		},
		async getUserDeskConfig(): Promise< DeskConfig | undefined > {
			return undefined;
		},
		async saveUserDeskConfig() {
			// No-op.
		},
		async getSiteDeskConfig(): Promise< DeskConfig | undefined > {
			return undefined;
		},
		async saveSiteDeskConfig() {
			// No-op.
		},

		async fetchSiteRest() {
			throw new SecexUnsupportedError( 'fetchSiteRest' );
		},

		async openSiteFolder() {
			throw new SecexUnsupportedError( 'openSiteFolder' );
		},
		async openSiteInEditor() {
			throw new SecexUnsupportedError( 'openSiteInEditor' );
		},
		async openSiteInTerminal() {
			throw new SecexUnsupportedError( 'openSiteInTerminal' );
		},

		async openExternalUrl( url ) {
			window.open( url, '_blank', 'noopener,noreferrer' );
		},
		async openSiteUrl() {
			throw new SecexUnsupportedError( 'openSiteUrl' );
		},

		async isFullscreen() {
			return false;
		},
		onFullscreenChange() {
			return () => {};
		},
		onSiteEvent() {
			return () => {};
		},
	};
}
