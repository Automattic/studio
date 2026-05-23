import { describe, expect, it, vi } from 'vitest';
import { bumpStat } from 'cli/lib/bump-stat';
import { StatsGroup, StatsMetric } from 'cli/lib/types/bump-stats';
import { RemoteSessionLogger } from 'cli/remote-session/logger';
import { runPollLoop, type PollLoopDeps } from 'cli/remote-session/poll-loop';
import type { RemoteSessionConfig } from 'cli/remote-session/config';
import type { PolledMessage } from 'cli/remote-session/telegram-client';
import type { TurnOutcome } from 'cli/remote-session/turn-runner';

vi.mock( 'cli/lib/bump-stat', () => ( {
	bumpStat: vi.fn(),
} ) );

const mockedBumpStat = vi.mocked( bumpStat );

const baseConfig: RemoteSessionConfig = {
	base_url: 'https://api.example.test/telegram-bot',
	token: 't',
	bot: 'b',
	chat_id: 42,
	poll_interval_seconds: 0.001,
	long_poll_timeout_seconds: 5,
	max_message_chars: 3800,
	turn_timeout_seconds: 1,
};

interface ScriptedPoll {
	script: Array< PolledMessage[] >;
	calls: number;
	done: Promise< void >;
	resolveDone: () => void;
}

function makeScriptedPoll( batches: Array< PolledMessage[] | PolledMessage > ): ScriptedPoll {
	let resolveDone: () => void = () => undefined;
	const done = new Promise< void >( ( r ) => {
		resolveDone = r;
	} );
	// Accept either bare messages or batch arrays, for ergonomic test writing.
	const script = batches.map( ( b ) => ( Array.isArray( b ) ? b : [ b ] ) );
	return { script, calls: 0, done, resolveDone };
}

function makeDeps(
	overrides: Partial< PollLoopDeps > & { scriptedPoll?: ScriptedPoll }
): PollLoopDeps {
	// respondMessage now returns a structured outcome — keep the mock honest so
	// the streamers and best-effort post helpers see a valid envelope.
	const respond = vi.fn().mockResolvedValue( { success: true, messageIds: [] } );
	const runTurn = vi.fn< ( args: unknown ) => Promise< TurnOutcome > >();
	const readState = vi.fn().mockResolvedValue( null );
	const writeSession = vi.fn().mockResolvedValue( undefined );
	const clearSession = vi.fn().mockResolvedValue( undefined );
	const sleep = vi.fn().mockResolvedValue( undefined );

	const scripted = overrides.scriptedPoll;
	const poll = scripted
		? vi.fn( async ( _config: RemoteSessionConfig, signal?: AbortSignal ) => {
				if ( scripted.calls >= scripted.script.length ) {
					scripted.resolveDone();
					// Emulate long-poll with no messages: block until the loop aborts.
					await new Promise< void >( ( resolve ) => {
						if ( signal?.aborted ) {
							resolve();
							return;
						}
						signal?.addEventListener( 'abort', () => resolve(), { once: true } );
					} );
					const err = new Error( 'aborted' );
					err.name = 'AbortError';
					throw err;
				}
				return scripted.script[ scripted.calls++ ];
		  } )
		: vi.fn().mockResolvedValue( [] );

	return {
		poll: poll as PollLoopDeps[ 'poll' ],
		respond,
		runTurn,
		readState,
		writeSession,
		clearSession,
		logger: new RemoteSessionLogger( { logPath: '/dev/null' } ),
		sleep,
		...overrides,
	};
}

describe( 'runPollLoop', () => {
	it( 'posts attach status, then the reply for a successful turn, then detach status', async () => {
		const scripted = makeScriptedPoll( [ { chat_id: 42, text: 'hello' } ] );
		const deps = makeDeps( { scriptedPoll: scripted } );
		( deps.runTurn as ReturnType< typeof vi.fn > ).mockResolvedValue( {
			status: 'success',
			sessionId: 'sess-1',
			replyText: 'Hi back',
			isError: false,
			stderrTail: '',
			exitCode: 0,
			staleSession: false,
		} satisfies TurnOutcome );

		const handle = await runPollLoop( { config: baseConfig, deps, cwd: '/fake/cwd' } );
		await scripted.done;
		await handle.detach();
		await handle.done;

		const respond = deps.respond as ReturnType< typeof vi.fn >;
		const bodies = respond.mock.calls.map( ( [ , params ] ) => params.text );
		expect( bodies[ 0 ] ).toMatch( /attached/ );
		expect( bodies ).toContain( 'Hi back' );
		expect( bodies.at( -1 ) ).toMatch( /detached/ );
		expect( deps.writeSession ).toHaveBeenCalledWith( 42, 'sess-1' );
	} );

	it( 'handles /new by clearing the session and acking, without invoking the agent', async () => {
		const scripted = makeScriptedPoll( [ { chat_id: 42, text: '/NEW' } ] );
		const deps = makeDeps( { scriptedPoll: scripted } );

		const handle = await runPollLoop( { config: baseConfig, deps } );
		await scripted.done;
		await handle.detach();
		await handle.done;

		expect( deps.runTurn ).not.toHaveBeenCalled();
		expect( deps.clearSession ).toHaveBeenCalledWith( 42 );
		const respond = deps.respond as ReturnType< typeof vi.fn >;
		const bodies = respond.mock.calls.map( ( [ , params ] ) => params.text );
		expect( bodies ).toContain( '🆕 Started a new conversation.' );
	} );

	it( 'retries once with no session id on stale-session outcome and posts the notice', async () => {
		const scripted = makeScriptedPoll( [ { chat_id: 42, text: 'continue?' } ] );
		const deps = makeDeps( { scriptedPoll: scripted } );
		( deps.readState as ReturnType< typeof vi.fn > ).mockResolvedValue( {
			chat_id: 42,
			session_id: 'stale',
		} );
		const runTurn = deps.runTurn as ReturnType< typeof vi.fn >;
		runTurn
			.mockResolvedValueOnce( {
				status: 'error',
				isError: true,
				stderrTail: 'No AI session found for resume ID',
				exitCode: 1,
				staleSession: true,
			} satisfies TurnOutcome )
			.mockResolvedValueOnce( {
				status: 'success',
				sessionId: 'fresh',
				replyText: 'recovered',
				isError: false,
				stderrTail: '',
				exitCode: 0,
				staleSession: false,
			} satisfies TurnOutcome );

		const handle = await runPollLoop( { config: baseConfig, deps } );
		await scripted.done;
		await handle.detach();
		await handle.done;

		expect( deps.clearSession ).toHaveBeenCalledWith( 42 );
		const respond = deps.respond as ReturnType< typeof vi.fn >;
		const bodies = respond.mock.calls.map( ( [ , params ] ) => params.text );
		expect( bodies ).toContain( 'ℹ️ Session expired; started a new one.' );
		expect( bodies ).toContain( 'recovered' );
		expect( deps.writeSession ).toHaveBeenCalledWith( 42, 'fresh' );
	} );

	it( 'ignores messages whose chat_id does not match the bound config', async () => {
		const scripted = makeScriptedPoll( [ { chat_id: 999, text: 'nope' } ] );
		const deps = makeDeps( { scriptedPoll: scripted } );

		const handle = await runPollLoop( { config: baseConfig, deps } );
		await scripted.done;
		await handle.detach();
		await handle.done;

		expect( deps.runTurn ).not.toHaveBeenCalled();
	} );

	it( 'skips empty messages with a warning instead of spawning the agent', async () => {
		const scripted = makeScriptedPoll( [ { chat_id: 42, text: '   ' } ] );
		const deps = makeDeps( { scriptedPoll: scripted } );

		const handle = await runPollLoop( { config: baseConfig, deps } );
		await scripted.done;
		await handle.detach();
		await handle.done;

		expect( deps.runTurn ).not.toHaveBeenCalled();
		const respond = deps.respond as ReturnType< typeof vi.fn >;
		const bodies = respond.mock.calls.map( ( [ , params ] ) => params.text );
		expect( bodies.some( ( b ) => b.includes( 'Empty message ignored' ) ) ).toBe( true );
	} );

	it( 'posts the fallback when the turn returns no reply and no question', async () => {
		const scripted = makeScriptedPoll( [ { chat_id: 42, text: 'hm' } ] );
		const deps = makeDeps( { scriptedPoll: scripted } );
		( deps.runTurn as ReturnType< typeof vi.fn > ).mockResolvedValue( {
			status: 'success',
			isError: false,
			stderrTail: '',
			exitCode: 0,
			staleSession: false,
		} satisfies TurnOutcome );

		const handle = await runPollLoop( { config: baseConfig, deps } );
		await scripted.done;
		await handle.detach();
		await handle.done;

		const respond = deps.respond as ReturnType< typeof vi.fn >;
		const bodies = respond.mock.calls.map( ( [ , params ] ) => params.text );
		expect( bodies ).toContain( '⚠️ Local agent did not return a result.' );
	} );

	it( 'posts media shares in real time before the text reply when both are present', async () => {
		const scripted = makeScriptedPoll( [ { chat_id: 42, text: 'show me' } ] );
		const deps = makeDeps( { scriptedPoll: scripted } );
		// Simulate the child emitting a media.share event mid-turn, then completing.
		( deps.runTurn as ReturnType< typeof vi.fn > ).mockImplementation(
			async ( opts: { onEvent?: ( event: unknown ) => void } ) => {
				opts.onEvent?.( {
					type: 'media.share',
					timestamp: 'now',
					mediaType: 'image',
					mimeType: 'image/png',
					dataBase64: 'AAAA',
					caption: 'Site preview',
				} );
				return {
					status: 'success',
					sessionId: 'sess-1',
					replyText: 'Want me to publish this as a preview site?',
					isError: false,
					stderrTail: '',
					exitCode: 0,
					staleSession: false,
				} satisfies TurnOutcome;
			}
		);

		const handle = await runPollLoop( { config: baseConfig, deps } );
		await scripted.done;
		await handle.detach();
		await handle.done;

		const respond = deps.respond as ReturnType< typeof vi.fn >;
		const calls = respond.mock.calls.map( ( [ , params ] ) => params );
		const photoIdx = calls.findIndex( ( p ) => p.photo === 'AAAA' );
		const textIdx = calls.findIndex(
			( p ) => p.text === 'Want me to publish this as a preview site?'
		);
		expect( photoIdx ).toBeGreaterThan( -1 );
		expect( textIdx ).toBeGreaterThan( -1 );
		expect( photoIdx ).toBeLessThan( textIdx );
		expect( calls[ photoIdx ] ).toEqual(
			expect.objectContaining( {
				chatId: 42,
				bot: 'b',
				photo: 'AAAA',
				photoMimeType: 'image/png',
				caption: 'Site preview',
			} )
		);
	} );

	it( 'posts media even when there is no text reply (no fallback warning)', async () => {
		const scripted = makeScriptedPoll( [ { chat_id: 42, text: 'just the screenshot' } ] );
		const deps = makeDeps( { scriptedPoll: scripted } );
		( deps.runTurn as ReturnType< typeof vi.fn > ).mockImplementation(
			async ( opts: { onEvent?: ( event: unknown ) => void } ) => {
				opts.onEvent?.( {
					type: 'media.share',
					timestamp: 'now',
					mediaType: 'image',
					mimeType: 'image/png',
					dataBase64: 'IMG',
				} );
				return {
					status: 'success',
					sessionId: 'sess-1',
					isError: false,
					stderrTail: '',
					exitCode: 0,
					staleSession: false,
				} satisfies TurnOutcome;
			}
		);

		const handle = await runPollLoop( { config: baseConfig, deps } );
		await scripted.done;
		await handle.detach();
		await handle.done;

		const respond = deps.respond as ReturnType< typeof vi.fn >;
		const params = respond.mock.calls.map( ( [ , p ] ) => p );
		expect( params.some( ( p ) => p.photo === 'IMG' ) ).toBe( true );
		expect( params.some( ( p ) => /did not return a result/.test( p.text ?? '' ) ) ).toBe( false );
	} );

	it( 'aborts an in-flight turn when detach is called and skips posting a reply', async () => {
		const scripted = makeScriptedPoll( [ { chat_id: 42, text: 'long task' } ] );
		const deps = makeDeps( { scriptedPoll: scripted } );

		// Capture the signal forwarded into runTurn so the test can drive detach
		// only once the turn is actually in flight.
		let resolveSignalSeen: ( signal: AbortSignal ) => void = () => undefined;
		const signalSeen = new Promise< AbortSignal >( ( r ) => {
			resolveSignalSeen = r;
		} );
		( deps.runTurn as ReturnType< typeof vi.fn > ).mockImplementation(
			( opts: { signal?: AbortSignal } ) => {
				if ( ! opts.signal ) {
					throw new Error( 'expected signal to be forwarded into runTurn' );
				}
				resolveSignalSeen( opts.signal );
				return new Promise< TurnOutcome >( ( resolve ) => {
					opts.signal!.addEventListener(
						'abort',
						() => {
							resolve( {
								status: 'timeout',
								isError: true,
								stderrTail: '',
								exitCode: null,
								staleSession: false,
							} satisfies TurnOutcome );
						},
						{ once: true }
					);
				} );
			}
		);

		const handle = await runPollLoop( { config: baseConfig, deps } );
		const signal = await signalSeen;
		expect( signal.aborted ).toBe( false );
		await handle.detach();
		await handle.done;

		expect( signal.aborted ).toBe( true );

		const respond = deps.respond as ReturnType< typeof vi.fn >;
		const bodies = respond.mock.calls.map( ( [ , params ] ) => params.text );
		expect( bodies.some( ( b ) => /Turn took too long/.test( b ) ) ).toBe( false );
		expect( bodies.some( ( b ) => /did not return a result/.test( b ) ) ).toBe( false );
		expect( bodies.at( -1 ) ).toMatch( /detached/ );
	} );

	describe( 'Dolly bump stats', () => {
		it( 'does not emit any bumps when telemetryEnabled is false (default)', async () => {
			const scripted = makeScriptedPoll( [ { chat_id: 42, text: 'hi' } ] );
			const deps = makeDeps( { scriptedPoll: scripted } );
			( deps.runTurn as ReturnType< typeof vi.fn > ).mockResolvedValue( {
				status: 'success',
				sessionId: 's',
				replyText: 'ok',
				isError: false,
				stderrTail: '',
				exitCode: 0,
				staleSession: false,
			} satisfies TurnOutcome );

			const handle = await runPollLoop( { config: baseConfig, deps } );
			await scripted.done;
			await handle.detach();
			await handle.done;

			expect( mockedBumpStat ).not.toHaveBeenCalled();
		} );

		it( 'emits attach, turn (success), and detach (requested) bumps for the happy path', async () => {
			const scripted = makeScriptedPoll( [ { chat_id: 42, text: 'hi' } ] );
			const deps = makeDeps( { scriptedPoll: scripted } );
			( deps.runTurn as ReturnType< typeof vi.fn > ).mockResolvedValue( {
				status: 'success',
				sessionId: 's',
				replyText: 'ok',
				isError: false,
				stderrTail: '',
				exitCode: 0,
				staleSession: false,
			} satisfies TurnOutcome );

			const handle = await runPollLoop( {
				config: baseConfig,
				deps,
				telemetryEnabled: true,
			} );
			await scripted.done;
			await handle.detach();
			await handle.done;

			expect( mockedBumpStat ).toHaveBeenCalledWith(
				StatsGroup.STUDIO_CLI_DOLLY_ATTACH,
				StatsMetric.SUCCESS
			);
			expect( mockedBumpStat ).toHaveBeenCalledWith(
				StatsGroup.STUDIO_CLI_DOLLY_TURN,
				StatsMetric.SUCCESS
			);
			expect( mockedBumpStat ).toHaveBeenCalledWith(
				StatsGroup.STUDIO_CLI_DOLLY_DETACH,
				StatsMetric.DETACH_REQUESTED
			);
		} );

		it( 'maps turn outcome statuses to the right metric (timeout, spawn_error)', async () => {
			const scripted = makeScriptedPoll( [
				{ chat_id: 42, text: 'first' },
				{ chat_id: 42, text: 'second' },
			] );
			const deps = makeDeps( { scriptedPoll: scripted } );
			const outcomes: TurnOutcome[] = [
				{
					status: 'timeout',
					isError: true,
					stderrTail: '',
					exitCode: null,
					staleSession: false,
				},
				{
					status: 'spawn_error',
					isError: true,
					stderrTail: 'boom',
					exitCode: null,
					staleSession: false,
				},
			];
			( deps.runTurn as ReturnType< typeof vi.fn > ).mockImplementation( () =>
				Promise.resolve( outcomes.shift()! )
			);

			const handle = await runPollLoop( {
				config: baseConfig,
				deps,
				telemetryEnabled: true,
			} );
			await scripted.done;
			await handle.detach();
			await handle.done;

			expect( mockedBumpStat ).toHaveBeenCalledWith(
				StatsGroup.STUDIO_CLI_DOLLY_TURN,
				StatsMetric.TURN_TIMEOUT
			);
			expect( mockedBumpStat ).toHaveBeenCalledWith(
				StatsGroup.STUDIO_CLI_DOLLY_TURN,
				StatsMetric.TURN_SPAWN_ERROR
			);
		} );

		it( 'records an auth-error detach when polling returns a TelegramAuthError', async () => {
			const deps = makeDeps( {} );
			const { TelegramAuthError } = await import( 'cli/remote-session/telegram-client' );
			( deps.poll as ReturnType< typeof vi.fn > ).mockRejectedValueOnce(
				new TelegramAuthError( 401 )
			);

			const handle = await runPollLoop( {
				config: baseConfig,
				deps,
				telemetryEnabled: true,
			} );
			await handle.done;

			expect( mockedBumpStat ).toHaveBeenCalledWith(
				StatsGroup.STUDIO_CLI_DOLLY_DETACH,
				StatsMetric.DETACH_AUTH_ERROR
			);
			// process.exitCode is set as a side effect; reset so it doesn't poison later tests.
			process.exitCode = 0;
		} );
	} );

	describe( 'when chat_id is not pinned in config', () => {
		const openConfig: RemoteSessionConfig = { ...baseConfig, chat_id: undefined, bot: undefined };

		it( 'does not post attach or detach status (no chat to post to)', async () => {
			const scripted = makeScriptedPoll( [] );
			const deps = makeDeps( { scriptedPoll: scripted } );

			const handle = await runPollLoop( { config: openConfig, deps } );
			await scripted.done;
			await handle.detach();
			await handle.done;

			expect( deps.respond ).not.toHaveBeenCalled();
		} );

		it( 'processes any polled chat and echoes chat_id + bot back when responding', async () => {
			const scripted = makeScriptedPoll( [ { chat_id: 7, text: 'hi', bot: 'their_bot' } ] );
			const deps = makeDeps( { scriptedPoll: scripted } );
			( deps.runTurn as ReturnType< typeof vi.fn > ).mockResolvedValue( {
				status: 'success',
				sessionId: 's',
				replyText: 'pong',
				isError: false,
				stderrTail: '',
				exitCode: 0,
				staleSession: false,
			} satisfies TurnOutcome );

			const handle = await runPollLoop( { config: openConfig, deps } );
			await scripted.done;
			await handle.detach();
			await handle.done;

			const respond = deps.respond as ReturnType< typeof vi.fn >;
			expect( respond ).toHaveBeenCalledWith(
				openConfig,
				expect.objectContaining( { chatId: 7, bot: 'their_bot', text: 'pong' } ),
				expect.objectContaining( { logger: expect.any( RemoteSessionLogger ) } )
			);
			expect( deps.writeSession ).toHaveBeenCalledWith( 7, 's' );
		} );
	} );
} );
