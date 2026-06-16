import { createDefaultDeskSettings } from '@studio/common/lib/desk-settings';
import { buildPreviewUrl } from './preview-blueprint';
import type {
	ActiveAgentRun,
	AiSessionSummary,
	AuthUser,
	Connector,
	DeskConfig,
	DeskSettings,
	FeaturedBlueprint,
	InstalledApps,
	LoadedAiSession,
	SessionEntry,
	SiteDetails,
	SitePreviewFile,
	Snapshot,
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
const SITES_KEY = 'studio-secex-sites';
const SITE_CLI_IDS_KEY = 'studio-secex-site-cli-session-ids';

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
	const previewListeners = new Set< ( sessionId: string ) => void >();
	const activeRuns = new Map<
		string,
		{ runId: string; sessionId: string; startedAt: number; controller: AbortController }
	>();

	function emit( runId: string, sessionId: string, event: AgentEvent ): void {
		const payload: AgentRunEvent = { runId, sessionId, event };
		agentListeners.forEach( ( listener ) => listener( payload ) );
	}

	// Opt-in connector tracing. Flip to `true` (or set localStorage
	// `studio-secex-debug`) to log the per-user run gate, /run posts, busy-retries,
	// SSE frames, and preview notifications — useful when diagnosing the SecEx
	// sandbox round-trip. Off by default to keep the console quiet.
	const SECEX_DEBUG =
		typeof window !== 'undefined' && window.localStorage?.getItem( 'studio-secex-debug' ) === '1';
	let postSeq = 0;
	let gateSeqCounter = 0;
	let inFlightPosts = 0;
	let gateDepth = 0;
	const dbg = ( ...args: unknown[] ): void => {
		if ( ! SECEX_DEBUG ) {
			return;
		}

		console.log(
			'%c[secex]',
			'color:#a06bff;font-weight:bold',
			`+${ Math.round( performance.now() ) }ms`,
			...args
		);
	};
	dbg( 'connector instance created', { runUrl, hasToken: Boolean( token ) } );

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

	// Sites created in the sandbox (via the agent's `site_create`). The /run
	// endpoint can't list the sandbox's sites yet, so we mirror them client-side
	// so the sidebar, routing, and session binding work like the desktop app.
	function getStoredSites(): SiteDetails[] {
		return readJson< SiteDetails[] >( SITES_KEY, [] );
	}
	function putStoredSites( sites: SiteDetails[] ): void {
		writeJson( SITES_KEY, sites );
	}
	function upsertStoredSite( site: SiteDetails ): void {
		const sites = getStoredSites().filter( ( s ) => s.id !== site.id );
		putStoredSites( [ site, ...sites ] );
	}

	// The CLI session id from a site's creation run, so the site's first chat
	// resumes that same warm sandbox session (where the new site is already the
	// active one) instead of starting cold.
	function setSiteCliSessionId( siteId: string, cliSessionId: string ): void {
		const map = readJson< Record< string, string > >( SITE_CLI_IDS_KEY, {} );
		map[ siteId ] = cliSessionId;
		writeJson( SITE_CLI_IDS_KEY, map );
	}
	function takeSiteCliSessionId( siteId: string ): string | undefined {
		const map = readJson< Record< string, string > >( SITE_CLI_IDS_KEY, {} );
		const value = map[ siteId ];
		if ( value ) {
			delete map[ siteId ];
			writeJson( SITE_CLI_IDS_KEY, map );
		}
		return value;
	}

	// The /run endpoint serializes turns per user with an advisory lock and rejects
	// a concurrent request with HTTP 429 + `{ code: 'busy' }`. That lock is held
	// until the END of the previous turn — including the post-stream durability step
	// (sandbox snapshot + pause), which runs for several seconds AFTER the client's
	// stream has already closed. So the first chat fired right after a create can
	// legitimately race that tail. We retry the POST with backoff when (and only
	// when) the body is the `busy` lock; a bodyless 429 (wpcom edge rate limiting)
	// is surfaced immediately. `onBusyWait` lets the caller show a "waiting" hint.
	const BUSY_RETRY_DELAYS_MS = [ 2000, 4000, 6000, 8000, 10000 ];

	function delay( ms: number, signal: AbortSignal ): Promise< void > {
		return new Promise( ( resolve, reject ) => {
			const timer = setTimeout( resolve, ms );
			signal.addEventListener(
				'abort',
				() => {
					clearTimeout( timer );
					reject( new DOMException( 'Aborted', 'AbortError' ) );
				},
				{ once: true }
			);
		} );
	}

	type RunPostResult =
		| { ok: true; response: Response }
		| { ok: false; status: number; text: string };

	async function postRun(
		body: Record< string, unknown >,
		signal: AbortSignal,
		onBusyWait?: ( attempt: number ) => void
	): Promise< RunPostResult > {
		const seq = ++postSeq;
		inFlightPosts++;
		const sessionTag = body.session_id
			? `resume:${ String( body.session_id ).slice( 0, 8 ) }`
			: 'fresh';
		dbg(
			`POST#${ seq } START`,
			`inFlight=${ inFlightPosts }`,
			sessionTag,
			`prompt="${ String( body.prompt ?? '' ).slice( 0, 60 ) }"`
		);
		if ( inFlightPosts > 1 ) {
			dbg( `⚠️ POST#${ seq } CONCURRENT — ${ inFlightPosts } posts in flight (gate breach?)` );
		}
		try {
			for ( let attempt = 0; ; attempt++ ) {
				const response = await fetch( runUrl, {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${ token }`,
						'X-WPCOM-AI-Feature': 'studio-code',
						'Content-Type': 'application/json',
					},
					body: JSON.stringify( body ),
					signal,
				} );
				dbg( `POST#${ seq } attempt#${ attempt } -> HTTP ${ response.status }` );
				if ( response.status !== 429 ) {
					return { ok: true, response };
				}
				// 429: peek the body. Only the endpoint's per-user lock (`busy`) is
				// retryable; a bodyless edge rate-limit is not.
				const text = await response.text().catch( () => '' );
				dbg( `POST#${ seq } 429 body:`, text || '(empty)' );
				if ( ! text.includes( '"busy"' ) || attempt >= BUSY_RETRY_DELAYS_MS.length ) {
					dbg( `POST#${ seq } GIVE UP — busy=${ text.includes( '"busy"' ) } attempt=${ attempt }` );
					return { ok: false, status: response.status, text };
				}
				dbg( `POST#${ seq } retry in ${ BUSY_RETRY_DELAYS_MS[ attempt ] }ms` );
				onBusyWait?.( attempt + 1 );
				await delay( BUSY_RETRY_DELAYS_MS[ attempt ], signal );
			}
		} finally {
			inFlightPosts--;
			dbg( `POST#${ seq } DONE inFlight=${ inFlightPosts }` );
		}
	}

	// The /run endpoint is strictly serial per user (a single advisory lock).
	// Mirror that on the client: chain every /run POST so we never have two in
	// flight at once — a second run waits for the first to finish streaming instead
	// of racing it into a `busy` 429. This covers the create→first-chat handoff and
	// the site-overview "new chat" path (which fires a run, then navigates to the
	// session view, which can start another). The busy-retry above stays as a safety
	// net for concurrency we don't control (e.g. another tab on the same user).
	let runGate: Promise< void > = Promise.resolve();
	function serializeRun< T >( fn: () => Promise< T > ): Promise< T > {
		const gseq = ++gateSeqCounter;
		gateDepth++;
		dbg( `gate#${ gseq } ENQUEUE depth=${ gateDepth }` );
		const start = (): Promise< T > => {
			dbg( `gate#${ gseq } START` );
			return fn();
		};
		const result = runGate.then( start, start );
		runGate = result.then(
			() => {
				gateDepth--;
				dbg( `gate#${ gseq } SETTLED ok depth=${ gateDepth }` );
			},
			() => {
				gateDepth--;
				dbg( `gate#${ gseq } SETTLED err depth=${ gateDepth }` );
			}
		);
		return result;
	}

	// Stream one /run turn: POST the prompt, parse the SSE frames, translate each
	// `data:` JsonEvent into an AgentRunEvent, and synthesize run lifecycle events.
	async function streamRun(
		runId: string,
		sessionId: string,
		prompt: string,
		controller: AbortController
	): Promise< void > {
		dbg(
			`streamRun run=${ runId.slice( 0, 8 ) } session=${ sessionId.slice( 0, 8 ) } — entering gate`
		);
		let priorCliSessionId = getCliSessionId( sessionId );
		let resolvedCliSessionId = priorCliSessionId;
		let sawError = false;

		await serializeRun( async () => {
			// Re-read inside the gate: a run that finished ahead of us in the chain may
			// have just learned (or created) the CLI session id we should resume.
			const cliSessionId = getCliSessionId( sessionId );
			priorCliSessionId = cliSessionId;
			resolvedCliSessionId = cliSessionId;
			try {
				const posted = await postRun(
					{
						prompt,
						...( cliSessionId ? { session_id: cliSessionId } : {} ),
					},
					controller.signal,
					( attempt ) =>
						appendEntry( sessionId, {
							type: 'custom',
							id: entryId(),
							parentId: null,
							timestamp: nowIso(),
							customType: 'studio.tool_progress',
							data: {
								message: `Waiting for the previous step to finish… (retry ${ attempt })`,
							},
						} as unknown as SessionEntry )
				);
				const response = posted.ok ? posted.response : undefined;

				if ( ! response || ! response.ok || ! response.body ) {
					const status = posted.ok ? posted.response.status : posted.status;
					const text = posted.ok ? await posted.response.text().catch( () => '' ) : posted.text;
					emit( runId, sessionId, {
						type: 'error',
						timestamp: nowIso(),
						message: `studio-code/run failed (${ status }): ${ text }`,
					} );
					sawError = true;
				} else {
					dbg( `run=${ runId.slice( 0, 8 ) } HTTP 200 — streaming started` );
					const reader = response.body.getReader();
					const decoder = new TextDecoder();
					let buffer = '';
					let frameCount = 0;

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
						frameCount++;
						dbg(
							`run=${ runId.slice( 0, 8 ) } frame#${ frameCount } event=${ eventName }`,
							`len=${ dataStr.length }`,
							dataStr.slice( 0, 140 )
						);
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

						// The deployed CLI (1.10.0, pi runtime) already emits pi-shaped events
						// that use-agent-run renders natively — message_start/update/end,
						// turn_start/turn_end, tool_execution_*, agent_end — each wrapped as
						// `{ type: 'message', message: <pi event> }`. Pass them straight through;
						// no translation is needed. (The earlier code translated for the old
						// Claude Agent SDK shape, whose `assistant`/`user` inner types never
						// matched the pi events, so it silently emitted nothing and the chat
						// stayed blank.) The CLI session id rides on the `turn.completed` event
						// as `sessionId` (camelCase) — capture it wherever it appears.
						resolvedCliSessionId =
							( json as { session_id?: string } ).session_id ??
							( json as { sessionId?: string } ).sessionId ??
							resolvedCliSessionId;

						if ( json.type === 'message' ) {
							const inner = json.message as {
								type?: string;
								session_id?: string;
								message?: unknown;
							};
							if ( inner?.session_id ) {
								resolvedCliSessionId = inner.session_id;
							}
							// Persist the assistant's terminal messages so the run-end getSession
							// refetch (and reloads) keep the conversation. Mirror exactly what
							// use-agent-run renders live (assistant `message_end`) so the
							// refetched history matches the optimistic stream — no duplicates,
							// no disappearing replies.
							if (
								inner?.type === 'message_end' &&
								( inner.message as { role?: string } )?.role === 'assistant'
							) {
								appendEntry( sessionId, {
									type: 'message',
									id: entryId(),
									parentId: null,
									timestamp: json.timestamp ?? nowIso(),
									message: inner.message,
								} as unknown as SessionEntry );
							}
							emit( runId, sessionId, json as AgentEvent );
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
					dbg(
						`run=${ runId.slice(
							0,
							8
						) } stream ENDED — frames=${ frameCount } sawError=${ sawError }`
					);
				}
			} catch ( error ) {
				dbg(
					`run=${ runId.slice( 0, 8 ) } stream threw:`,
					( error as Error ).name,
					( error as Error ).message
				);
				if ( ( error as Error ).name !== 'AbortError' ) {
					emit( runId, sessionId, {
						type: 'error',
						timestamp: nowIso(),
						message: ( error as Error ).message || 'studio-code/run stream failed',
					} );
					sawError = true;
				}
			}
		} );

		if ( resolvedCliSessionId && resolvedCliSessionId !== priorCliSessionId ) {
			setCliSessionId( sessionId, resolvedCliSessionId );
		}
		try {
			patchSession( sessionId, {} );
		} catch {
			// Session may have been deleted mid-run.
		}
		dbg(
			`run=${ runId.slice( 0, 8 ) } run.exited status=${ sawError ? 'error' : 'success' }`,
			`resolvedCli=${ resolvedCliSessionId?.slice( 0, 8 ) ?? 'none' }`
		);
		emit( runId, sessionId, {
			type: 'run.exited',
			timestamp: nowIso(),
			status: sawError ? 'error' : 'success',
			code: sawError ? 1 : 0,
		} );
		// The agent may have edited the site this turn — tell the live preview to
		// re-export and re-render. Fire even on error/interrupt: the agent often
		// applies changes before a long run drops (e.g. an HTTP/2 timeout), so the
		// re-export should reflect whatever state the site is actually in.
		dbg( `run=${ runId.slice( 0, 8 ) } notifying ${ previewListeners.size } preview listener(s)` );
		previewListeners.forEach( ( listener ) => listener( sessionId ) );
	}

	interface SiteCreateResult {
		id: string;
		name: string;
		path: string;
		url?: string;
		// CLI session id of the creation run, so the site's first chat can resume it.
		cliSessionId?: string;
	}

	// Pull the CLI session id out of a frame (it rides in `session`/`done` events
	// and in each message's `session_id`).
	function extractSessionId( dataStr: string ): string | undefined {
		try {
			const parsed = JSON.parse( dataStr ) as {
				session_id?: string;
				message?: { session_id?: string };
			};
			return parsed.session_id ?? parsed.message?.session_id;
		} catch {
			return undefined;
		}
	}

	// Pull the `site_create` tool result out of one streamed tool turn. The tool
	// returns `textResult(JSON.stringify({ id, name, path, url, ... }))`, which the
	// CLI surfaces as a `tool_result` block inside a `user` message. We dig that
	// block out and JSON-parse it.
	function extractSiteFromFrame( dataStr: string ): SiteCreateResult | undefined {
		let json: JsonEvent;
		try {
			json = JSON.parse( dataStr ) as JsonEvent;
		} catch {
			return undefined;
		}
		if ( json.type !== 'message' ) {
			return undefined;
		}
		const inner = json.message as {
			type?: string;
			message?: { content?: unknown };
		};
		if ( inner?.type !== 'user' ) {
			return undefined;
		}
		const content = inner.message?.content;
		const candidates: string[] = [];
		const pushBlock = ( block: unknown ): void => {
			if ( ! block || typeof block !== 'object' ) {
				return;
			}
			const typed = block as { type?: string; text?: string; content?: unknown };
			if ( typed.type === 'text' && typeof typed.text === 'string' ) {
				candidates.push( typed.text );
			} else if ( typed.type === 'tool_result' ) {
				if ( typeof typed.content === 'string' ) {
					candidates.push( typed.content );
				} else if ( Array.isArray( typed.content ) ) {
					typed.content.forEach( pushBlock );
				}
			}
		};
		if ( typeof content === 'string' ) {
			candidates.push( content );
		} else if ( Array.isArray( content ) ) {
			content.forEach( pushBlock );
		}
		for ( const text of candidates ) {
			try {
				const parsed = JSON.parse( text ) as Partial< SiteCreateResult >;
				if ( parsed.id && parsed.name && parsed.path ) {
					return {
						id: parsed.id,
						name: parsed.name,
						path: parsed.path,
						url: parsed.url,
					};
				}
			} catch {
				// Not the site_create result blob.
			}
		}
		return undefined;
	}

	// Sandbox sites live under STUDIO_SITES_ROOT, which is ~/Studio for the
	// sandbox user (overridable for other deployments).
	const SANDBOX_SITES_ROOT = import.meta.env.VITE_STUDIO_SECEX_SITES_ROOT ?? '/home/user/Studio';

	function slugify( name: string ): string {
		return name
			.toLowerCase()
			.replace( /[^a-z0-9]+/g, '-' )
			.replace( /^-|-$/g, '' );
	}

	// Create a site in the sandbox by driving the deployed Studio CLI directly
	// with `--no-start`. We do NOT use the agent's `site_create` tool because it
	// always starts the server, which can't boot in the sandbox (PHP-WASM) and
	// makes the create command roll back and delete the site. `--no-start`
	// persists the site (the preview is rendered client-side, not served from the
	// sandbox). This works against the deployed template — no rebuild needed.
	//
	// We detect success from the CLI's "Site created successfully" marker (and pull
	// the site id/path from the tool output if present, else derive them from the
	// deterministic sandbox path), but we DRAIN the stream to completion rather than
	// aborting early. Aborting the client fetch does not stop the run inside the
	// sandbox: the endpoint keeps the agent's turn alive and holds the per-user
	// `studio_code_session` lock until that run finishes. The first chat then adopts
	// the same warm CLI session and collides with the still-running create — the
	// endpoint rejects the concurrent /run with a 429. Draining lets the lock
	// release cleanly so the follow-up chat succeeds.
	async function createSiteViaAgent( name: string ): Promise< SiteCreateResult > {
		dbg( `createSiteViaAgent name="${ name }"` );
		const slug = slugify( name );
		if ( ! slug ) {
			throw new Error( 'Site name must contain at least one letter or digit (a-z, 0-9).' );
		}
		const sandboxPath = `${ SANDBOX_SITES_ROOT }/${ slug }`;
		// Sanitize the name we interpolate into the prompt (the real name is
		// preserved in the returned SiteDetails).
		const safeName = name.replace( /["\\\n]/g, '' ).trim() || slug;

		const controller = new AbortController();
		// The sandbox agent only uses the `mcp__studio__` tools (it refuses Bash for
		// site management), so drive `site_create` directly. The hosted template's
		// CLI skips the server start (no-start), so the site persists instead of
		// rolling back on the PHP-WASM start failure.
		const prompt =
			`Use the site_create tool to create a new WordPress site named "${ safeName }". ` +
			`Create only that one site, then stop — do not install plugins, add content, or take other actions.`;
		return serializeRun( async () => {
			const posted = await postRun( { prompt }, controller.signal );
			if ( ! posted.ok ) {
				throw new Error( `studio-code/run failed (${ posted.status }): ${ posted.text }` );
			}
			const response = posted.response;
			if ( ! response.ok || ! response.body ) {
				const text = await response.text().catch( () => '' );
				throw new Error( `studio-code/run failed (${ response.status }): ${ text }` );
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let result: SiteCreateResult | undefined;
			let cliSessionId: string | undefined;
			let succeeded = false;

			const scan = ( frame: string ): void => {
				const dataLines: string[] = [];
				for ( const line of frame.split( '\n' ) ) {
					if ( line.startsWith( 'data:' ) ) {
						dataLines.push( line.slice( 5 ).replace( /^ /, '' ) );
					}
				}
				const dataStr = dataLines.join( '\n' );
				if ( ! dataStr ) {
					return;
				}
				cliSessionId = cliSessionId ?? extractSessionId( dataStr );
				result = result ?? extractSiteFromFrame( dataStr );
				// The CLI prints this on a successful create (with or without --start).
				if ( dataStr.includes( 'Site created successfully' ) ) {
					succeeded = true;
				}
			};

			try {
				for (;;) {
					const { value, done } = await reader.read();
					if ( done ) {
						break;
					}
					buffer += decoder.decode( value, { stream: true } );
					let sep = buffer.indexOf( '\n\n' );
					while ( sep !== -1 ) {
						scan( buffer.slice( 0, sep ) );
						buffer = buffer.slice( sep + 2 );
						sep = buffer.indexOf( '\n\n' );
					}
				}
				if ( buffer.trim() ) {
					scan( buffer );
				}
			} catch ( error ) {
				if ( ( error as Error ).name !== 'AbortError' ) {
					throw error;
				}
			}

			if ( ! result && ! succeeded ) {
				throw new Error(
					'Site creation did not complete — the agent may not have created the site.'
				);
			}
			return {
				id: result?.id ?? crypto.randomUUID(),
				name: result?.name ?? name,
				path: result?.path ?? sandboxPath,
				url: result?.url,
				cliSessionId,
			};
		} );
	}

	// The `/export` sibling of the `/run` endpoint: a deterministic, agent-free
	// file dump. Asking the agent to base64 the theme tripped its exfiltration
	// guard ("I'm not able to run that command — it reads every file…"), so the
	// endpoint runs the export node script directly via the sandbox commands API
	// (no model turn) and returns `{ files: { path: base64 } }`. Fast (~1-2s, no
	// agent), reliable (no refusal), and free (no model cost).
	const exportUrl = runUrl.replace( /\/run(\?|$)/, '/export$1' );

	// Export the session site's edited theme from the sandbox for a client-side
	// Playground preview. Goes through the serialization gate so it never races a
	// chat turn into the endpoint's per-user `busy` lock.
	async function exportSiteFiles( sitePath: string ): Promise< SitePreviewFile[] > {
		return serializeRun( async () => {
			dbg( `exportSiteFiles START path=${ sitePath }` );
			try {
				const response = await fetch( exportUrl, {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${ token }`,
						'X-WPCOM-AI-Feature': 'studio-code',
						'Content-Type': 'application/json',
					},
					body: JSON.stringify( { path: sitePath } ),
				} );
				if ( ! response.ok ) {
					dbg( `exportSiteFiles HTTP ${ response.status }` );
					return [];
				}
				const data = ( await response.json() ) as { files?: Record< string, string > };
				const files = Object.entries( data.files ?? {} ).map( ( [ path, contentBase64 ] ) => ( {
					path,
					contentBase64,
				} ) );
				dbg( `exportSiteFiles DONE files=${ files.length }` );
				return files;
			} catch ( error ) {
				dbg( `exportSiteFiles error: ${ ( error as Error ).message }` );
				return [];
			}
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

		// Sites — the agentic UI is site-centric (chats hang off a site). Studio Web
		// sites are created by the agent (`site_create`) inside the SecEx sandbox
		// and mirrored client-side. With no sites yet, the UI shows the onboarding
		// "create a site" flow (reused from the desktop app).
		async getSites(): Promise< SiteDetails[] > {
			return getStoredSites();
		},
		// Reuse the desktop create-site form/onboarding: this drives the agent's
		// `site_create` in the sandbox, mirrors the result client-side, and returns
		// a SiteDetails so the UI navigates into the new site like the desktop app.
		// `url` is a client-side WordPress Playground URL (foreign origin); the
		// dashboard renders it in a bare iframe (PlaygroundPreviewFrame) rather than
		// SitePreview, whose same-origin machinery would OOM-crash a cross-origin one.
		async createSite( params ): Promise< SiteDetails > {
			const created = await createSiteViaAgent( params.name );
			const site: SiteDetails = {
				id: created.id,
				name: created.name,
				path: created.path,
				port: 0,
				// Not served from the sandbox (PHP-WASM can't boot there); the preview
				// is client-side Playground, so the "running" server concept doesn't apply.
				running: false,
				url: buildPreviewUrl( created.name ),
				phpVersion: '',
			};
			upsertStoredSite( site );
			// Remember the creation run's CLI session so the site's first chat resumes
			// it (the new site is already the active site in that warm sandbox session).
			if ( created.cliSessionId ) {
				setSiteCliSessionId( created.id, created.cliSessionId );
			}
			return site;
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
		async generateProposedSitePath( siteName ) {
			// Studio Web has no local filesystem — the site is created inside the
			// SecEx sandbox. Return a synthetic, non-empty path so the reused desktop
			// create form validates (createSite ignores the path and the agent
			// creates the site under STUDIO_SITES_ROOT in the sandbox).
			const slug = slugify( siteName ) || 'site';
			return { path: `${ SANDBOX_SITES_ROOT }/${ slug }`, isEmpty: true, isWordPress: false };
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
		async createSession( siteId ): Promise< AiSessionSummary > {
			const now = nowIso();
			// Bind the session to its owner site (created via site_create) so the
			// sidebar groups it and the session view shows the header + preview
			// toggle (canTogglePreview needs an ownerSite resolved by ownerSitePath).
			const site = siteId ? getStoredSites().find( ( s ) => s.id === siteId ) : undefined;
			const summary: AiSessionSummary = {
				id: crypto.randomUUID(),
				filePath: '',
				createdAt: now,
				updatedAt: now,
				activeEnvironment: 'local',
				eventCount: 0,
				ownerSiteName: site?.name,
				ownerSitePath: site?.path,
				selectedSiteName: site?.name,
			};
			putSessions( [ summary, ...getSessions() ] );
			// Adopt the site's creation-run CLI session for this first chat, so the
			// agent resumes with the new site already active (warm sandbox session).
			if ( siteId ) {
				const cliSessionId = takeSiteCliSessionId( siteId );
				if ( cliSessionId ) {
					setCliSessionId( summary.id, cliSessionId );
				}
			}
			dbg(
				`createSession siteId=${ siteId?.slice( 0, 8 ) ?? 'none' } -> session=${ summary.id.slice(
					0,
					8
				) }`,
				`adoptedCli=${ getCliSessionId( summary.id )?.slice( 0, 8 ) ?? 'none' }`
			);
			return summary;
		},
		async continueSession( sessionId, prompt, options ): Promise< { runId: string } > {
			const runId = crypto.randomUUID();
			dbg(
				`continueSession session=${ sessionId.slice( 0, 8 ) } run=${ runId.slice( 0, 8 ) }`,
				`activeRuns=${ activeRuns.size }`,
				`cliSession=${ getCliSessionId( sessionId )?.slice( 0, 8 ) ?? 'none' }`,
				new Error( 'continueSession caller' ).stack?.split( '\n' ).slice( 2, 5 ).join( ' | ' )
			);
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

		// Export the session site's edited theme from the sandbox so the live
		// client-side Playground preview reflects what the agent actually built
		// (not just a clean WordPress). Uses the session's warm CLI session.
		async getSiteFiles( sessionId ): Promise< SitePreviewFile[] > {
			const session = getSessions().find( ( s ) => s.id === sessionId );
			const sitePath = session?.ownerSitePath;
			if ( ! sitePath ) {
				return [];
			}
			return exportSiteFiles( sitePath );
		},
		onPreviewChanged( listener ) {
			previewListeners.add( listener );
			return () => previewListeners.delete( listener );
		},

		// User preferences — browser defaults.
		async getUserPreferences(): Promise< UserPreferences > {
			return {
				editor: null,
				terminal: null,
				colorScheme: 'system',
				locale: undefined,
			};
		},
		async setUserPreferences() {
			// No-op.
		},
		async getInstalledApps(): Promise< InstalledApps > {
			return {} as InstalledApps;
		},

		// Desks — defaults so both UI modes mount cleanly.
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
		onToggleSitePreview() {
			// No application menu in a browser tab.
			return () => {};
		},
	};
}
