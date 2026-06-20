import fs from 'node:fs/promises';
import { detectSessionFormat, migrateLegacyEvents } from '@studio/common/ai/sessions/migration';
import { loadAiSession } from '@studio/common/ai/sessions/store';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { getAiSessionsRootDirectory } from 'cli/ai/sessions/paths';
import { wdbg } from './debug';
import type { AgentProcess, AgentProcessOptions, AgentRuntime } from './runtime';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { JsonEvent } from '@studio/common/ai/json-events';

/**
 * Runs the agent inside a hosted SecEx sandbox by driving the wpcom
 * `studio-code` endpoint (Automattic/wpcom: `POST /wpcom/v2/studio-code/run`).
 * The endpoint runs `studio code --json` in a per-user sandbox and streams the
 * CLI's events back over SSE; this runtime relays them through the same
 * {@link AgentRuntime} callbacks the local runtime uses, so the run-manager and
 * the browser don't change.
 *
 * One sandbox per user (the endpoint resolves it from the caller's token), the
 * cloud analog of "your laptop" — the same `~/Studio/` sites and `~/.claude`
 * sessions live inside it, like the desktop app.
 *
 * Interactive questions work like the desktop, despite there being no live
 * process to answer: when a turn pauses on a question, the CLI ends the turn
 * with `status: 'paused'`; the agent process here stays "connected" rather than
 * exiting, and a later {@link AgentProcess.answer} re-drives the endpoint with
 * the user's choice as the next message on the same sandbox session (the proven
 * headless resume pattern — see apps/cli/remote-session/turn-runner.ts). The
 * web-server and UI see an ordinary live run that asks and gets answered.
 *
 * Opt-in: the web-server only installs this runtime when `STUDIO_WEB_BACKEND=secex`,
 * so the default (local child process) path is untouched.
 */

const DEFAULT_RUN_URL = 'https://public-api.wordpress.com/wpcom/v2/studio-code/run';

// Maps the web-server session id to the CLI/SDK session id the endpoint reports
// (via `turn.completed.sessionId`), so the next message resumes the same
// conversation in the sandbox.
const cliSessionIds = new Map< string, string >();

export interface SecexRuntimeOptions {
	// The studio-code `/run` endpoint. Override for sandboxes / testing.
	runUrl?: string;
}

// Outcome of one turn (one `/run` request/stream).
interface TurnResult {
	// True when the turn reached a terminal state (the agent is done for now);
	// false when it paused on a question and is waiting for an answer.
	done: boolean;
	// Exit code for terminal turns. Ignored while paused.
	code: number;
}

export function createSecexRuntime( {
	runUrl = DEFAULT_RUN_URL,
}: SecexRuntimeOptions = {} ): AgentRuntime {
	return {
		start( {
			sessionId,
			prompt,
			onSpawn,
			onEvent,
			onError,
			onExit,
		}: AgentProcessOptions ): AgentProcess {
			let controller = new AbortController();
			let connected = true;
			let spawned = false;

			// Run a single turn against the endpoint and report whether it ended
			// terminally or paused on a question.
			const runTurn = async ( message: string ): Promise< TurnResult > => {
				controller = new AbortController();

				const token = await readAuthToken().catch( () => null );
				if ( ! token ) {
					onError( 'Not signed in to WordPress.com — run `studio auth login` first.' );
					return { done: true, code: 1 };
				}

				const resumeId = cliSessionIds.get( sessionId );
				wdbg( 'secex', 'POST /run', {
					runUrl,
					resume: resumeId ?? '(new)',
					message: message.slice( 0, 80 ),
				} );

				const requestInit: RequestInit = {
					method: 'POST',
					signal: controller.signal,
					headers: {
						Authorization: `Bearer ${ token.accessToken }`,
						'X-WPCOM-AI-Feature': 'studio-code',
						'Content-Type': 'application/json',
					},
					body: JSON.stringify( {
						prompt: message,
						session_id: resumeId,
					} ),
				};

				// The endpoint holds a per-user run lock; the just-ended turn's lock
				// can linger briefly, so resuming right after answering a question may
				// 429. Back off and retry a few times before giving up.
				let response = await fetch( runUrl, requestInit );
				for ( let attempt = 0; response.status === 429 && attempt < 6; attempt++ ) {
					wdbg( 'secex', 'run busy (429) — backing off', { attempt } );
					await new Promise( ( resolve ) => setTimeout( resolve, 3000 ) );
					response = await fetch( runUrl, requestInit );
				}

				wdbg( 'secex', 'response', { status: response.status, ok: response.ok } );

				if ( ! response.ok || ! response.body ) {
					const text = await response.text().catch( () => '' );
					onError( `studio-code /run failed (${ response.status }): ${ text }` );
					return { done: true, code: 1 };
				}

				if ( ! spawned ) {
					spawned = true;
					onSpawn();
				}

				let paused = false;
				let errored = false;
				// True once a turn.completed with status 'success' arrives. The
				// studio-code resume command can exit non-zero AFTER a successful
				// turn, emitting a trailing (often empty) `error` frame; that tail
				// must not flip a turn the agent actually finished into a failure.
				let completedOk = false;
				// The session cache write must finish before this turn resolves, so
				// the run-end `getSession` the UI fires doesn't read a half-written
				// file. Captured here and awaited after the stream drains.
				let cacheWrite: Promise< void > | undefined;

				await readSse( response.body, ( event, data ) => {
					if ( event === 'data' ) {
						const jsonEvent = data as JsonEvent;
						if ( jsonEvent.type === 'turn.completed' ) {
							if ( jsonEvent.sessionId ) {
								cliSessionIds.set( sessionId, jsonEvent.sessionId );
							}
							// A paused turn isn't an error or an ending — the agent
							// asked a question and is waiting for the next message.
							paused = jsonEvent.status === 'paused';
							errored = jsonEvent.status === 'error';
							completedOk = jsonEvent.status === 'success';
							wdbg( 'secex', 'turn.completed', {
								status: jsonEvent.status,
								cliSessionId: jsonEvent.sessionId,
							} );
							// Don't surface a paused completion to the UI: the agent is
							// waiting on an answer, and a `turn.completed` there would
							// clear the just-asked question and make its answer options
							// non-interactive. The `question.asked` event already drove it.
							if ( paused ) {
								return;
							}
						}
						onEvent( jsonEvent );
					} else if ( event === 'error' ) {
						// Ignore a trailing error frame once the turn already finished
						// successfully — the resume command's non-zero exit shouldn't
						// fail a completed turn (the change is already applied).
						if ( completedOk ) {
							wdbg( 'secex', 'ignoring trailing error after successful turn', {} );
						} else {
							errored = true;
							const payload = data as { message?: string; stderr?: string };
							onError( payload.message ?? payload.stderr ?? 'studio-code run error' );
						}
					} else if ( event === 'session' ) {
						// The endpoint's run-boundary sync: the canonical session
						// JSONL from the sandbox. Cache it locally so the broker's own
						// getSession returns the conversation (the sandbox stays the
						// source of truth). Fire-and-forget; never blocks the stream.
						const payload = data as { jsonl?: string };
						if ( typeof payload.jsonl === 'string' && payload.jsonl ) {
							wdbg( 'secex', 'session snapshot', { bytes: payload.jsonl.length } );
							cacheWrite = cacheSandboxSession( sessionId, payload.jsonl ).catch(
								( cacheError ) => {
									wdbg( 'secex', 'session cache failed', { error: String( cacheError ) } );
								}
							);
						}
					}
					// 'done' just marks the end of the stream; the loop ends on its own.
				} );

				// Finish persisting the cache before the turn resolves and onExit
				// triggers the UI's getSession refetch.
				if ( cacheWrite ) {
					await cacheWrite;
				}

				return { done: ! paused, code: errored ? 1 : 0 };
			};

			// Drive one turn; exit only when it ends terminally. While paused we
			// stay connected and wait for answer() to drive the next turn.
			const drive = ( message: string ): void => {
				void runTurn( message )
					.catch( ( error ): TurnResult => {
						if ( ! controller.signal.aborted ) {
							onError( error instanceof Error ? error.message : String( error ) );
						}
						return { done: true, code: 1 };
					} )
					.then( ( result ) => {
						if ( controller.signal.aborted ) {
							wdbg( 'secex', 'drive: aborted' );
							connected = false;
							onExit( null );
						} else if ( result.done ) {
							wdbg( 'secex', 'drive: done', { code: result.code } );
							connected = false;
							onExit( result.code );
						} else {
							wdbg( 'secex', 'drive: paused (awaiting answer)' );
						}
						// Paused: stay connected; answer() will resume.
					} );
			};

			drive( prompt );

			return {
				get connected() {
					return connected;
				},
				interrupt() {
					// No interrupt route on the endpoint; aborting the stream makes
					// the sandbox kill the CLI (and still snapshot partial state).
					controller.abort();
				},
				kill() {
					connected = false;
					controller.abort();
				},
				answer( answers: Record< string, string > ) {
					// The agent paused on a question; the user's choice resumes the
					// conversation as the next message on the same sandbox session.
					const message = Object.values( answers ).join( '\n' ).trim();
					wdbg( 'secex', 'answer', { answers, message: message.slice( 0, 80 ) } );
					if ( message ) {
						drive( message );
					}
				},
			};
		},
	};
}

/**
 * Cache the sandbox's canonical session into the broker's local session store,
 * so the web-server's own `getSession` returns the conversation that ran
 * remotely (the sandbox snapshot remains the source of truth).
 *
 * The sandbox writes Studio sessions in the on-disk legacy format. We run the
 * same legacy→pi migration `loadAiSession` applies on read, then re-id the
 * session header to the web-server's session id — the id getSession resolves by,
 * and the one thing the read-time migration can't fix. The result is written to
 * the local file the browser's session id already maps to.
 *
 * @param webSessionId The web-server session id (what the browser holds).
 * @param jsonl        The canonical session JSONL read from the sandbox.
 */
async function cacheSandboxSession( webSessionId: string, jsonl: string ): Promise< void > {
	const root = getAiSessionsRootDirectory();

	// Resolve the local file the browser's session id maps to (created up front
	// by createAiSession). If it's gone, there's nothing to cache into.
	const { summary } = await loadAiSession( root, webSessionId );

	const lines = jsonl.split( '\n' ).filter( ( line ) => line.trim() );
	if ( 0 === lines.length ) {
		return;
	}

	let entries: SessionEntry[];
	if ( 'legacy' === detectSessionFormat( lines[ 0 ] ) ) {
		const events = lines.map( ( line ) => JSON.parse( line ) ) as Parameters<
			typeof migrateLegacyEvents
		>[ 0 ];
		entries = migrateLegacyEvents( events, '~/Studio' ) as unknown as SessionEntry[];
	} else {
		entries = lines.map( ( line ) => JSON.parse( line ) as SessionEntry );
	}

	for ( const entry of entries ) {
		const header = entry as { type?: string; id?: string };
		if ( 'session' === header.type ) {
			header.id = webSessionId;
			break;
		}
	}

	const out = entries.map( ( entry ) => JSON.stringify( entry ) ).join( '\n' ) + '\n';
	await fs.writeFile( summary.filePath, out, 'utf8' );
}

/**
 * Reads a Server-Sent Events stream of named events (`event:` + `data:` lines,
 * frames separated by a blank line), parsing each frame's `data` as JSON. The
 * `studio-code` endpoint emits one JSON payload per frame, so frames don't need
 * reassembly beyond joining multi-line `data:` fields.
 */
async function readSse(
	body: ReadableStream< Uint8Array >,
	onFrame: ( event: string, data: unknown ) => void
): Promise< void > {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if ( done ) {
				break;
			}
			buffer += decoder.decode( value, { stream: true } );
			let sep: number;
			while ( ( sep = buffer.indexOf( '\n\n' ) ) !== -1 ) {
				const frame = buffer.slice( 0, sep );
				buffer = buffer.slice( sep + 2 );
				let event = 'message';
				const dataLines: string[] = [];
				for ( const line of frame.split( '\n' ) ) {
					if ( line.startsWith( 'event:' ) ) {
						event = line.slice( 6 ).trim();
					} else if ( line.startsWith( 'data:' ) ) {
						dataLines.push( line.slice( 5 ).replace( /^ /, '' ) );
					}
				}
				if ( dataLines.length === 0 ) {
					continue;
				}
				try {
					onFrame( event, JSON.parse( dataLines.join( '\n' ) ) );
				} catch {
					// Ignore malformed frames.
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}
