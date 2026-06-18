import { readAuthToken } from '@studio/common/lib/shared-config';
import type { AgentProcess, AgentProcessOptions, AgentRuntime } from './runtime';
import type { JsonEvent } from '@studio/common/ai/json-events';

/**
 * Runs the agent inside a hosted SecEx sandbox by driving the wpcom
 * `studio-code` endpoint (Automattic/wpcom: `POST /wpcom/v2/studio-code/run`).
 * The endpoint runs `studio code --json <prompt>` in a per-user sandbox and
 * streams the CLI's events back over SSE; this runtime relays them through the
 * same {@link AgentRuntime} callbacks the local runtime uses, so the run-manager
 * and the browser don't change.
 *
 * One sandbox per user (the endpoint resolves it from the caller's token), the
 * cloud analog of "your laptop" — the same `~/Studio/` sites and `~/.claude`
 * sessions live inside it, like the desktop app.
 *
 * Opt-in: the web-server only installs this runtime when `STUDIO_WEB_BACKEND=secex`,
 * so the default (local child process) path is untouched.
 */

const DEFAULT_RUN_URL = 'https://public-api.wordpress.com/wpcom/v2/studio-code/run';

// Maps our web-server session id to the CLI `session_id` the endpoint returns,
// so the next turn resumes the same conversation in the sandbox.
const cliSessionIds = new Map< string, string >();

export interface SecexRuntimeOptions {
	// The studio-code `/run` endpoint. Override for sandboxes / testing.
	runUrl?: string;
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
			const controller = new AbortController();
			let open = true;

			void runTurn( {
				runUrl,
				sessionId,
				prompt,
				signal: controller.signal,
				onSpawn,
				onEvent,
				onError,
			} )
				.catch( ( error ) => {
					if ( ! controller.signal.aborted ) {
						onError( error instanceof Error ? error.message : String( error ) );
					}
					return { code: 1 };
				} )
				.then( ( result ) => {
					open = false;
					onExit( controller.signal.aborted ? null : result.code );
				} );

			return {
				get connected() {
					return open;
				},
				interrupt() {
					// The endpoint has no interrupt route; closing the stream makes it
					// kill the CLI in the sandbox (and still snapshot partial state).
					controller.abort();
				},
				kill() {
					controller.abort();
				},
				answer() {
					// No-op: the endpoint runs `studio code --json` with --auto-approve,
					// so the agent never blocks waiting for an answer.
				},
			};
		},
	};
}

interface RunTurnArgs {
	runUrl: string;
	sessionId: string;
	prompt: string;
	signal: AbortSignal;
	onSpawn: () => void;
	onEvent: ( event: JsonEvent ) => void;
	onError: ( message: string ) => void;
}

async function runTurn( args: RunTurnArgs ): Promise< { code: number } > {
	const { runUrl, sessionId, prompt, signal, onSpawn, onEvent, onError } = args;

	const token = await readAuthToken().catch( () => null );
	if ( ! token ) {
		onError( 'Not signed in to WordPress.com — run `studio auth login` first.' );
		return { code: 1 };
	}

	const response = await fetch( runUrl, {
		method: 'POST',
		signal,
		headers: {
			Authorization: `Bearer ${ token.accessToken }`,
			'X-WPCOM-AI-Feature': 'studio-code',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify( { prompt, session_id: cliSessionIds.get( sessionId ) } ),
	} );

	if ( ! response.ok || ! response.body ) {
		const text = await response.text().catch( () => '' );
		onError( `studio-code /run failed (${ response.status }): ${ text }` );
		return { code: 1 };
	}

	onSpawn();

	let errored = false;
	await readSse( response.body, ( event, data ) => {
		if ( event === 'session' ) {
			const id = ( data as { session_id?: string } ).session_id;
			if ( id ) {
				cliSessionIds.set( sessionId, id );
			}
		} else if ( event === 'data' ) {
			onEvent( data as JsonEvent );
		} else if ( event === 'error' ) {
			errored = true;
			const payload = data as { message?: string; stderr?: string };
			onError( payload.message ?? payload.stderr ?? 'studio-code run error' );
		}
		// 'done' just marks the end of the stream; the loop ends on its own.
	} );

	return { code: errored ? 1 : 0 };
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
