import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { runTurn } from 'cli/remote-session/turn-runner';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const mockCli = path.join( here, 'fixtures', 'mock-studio-code.mjs' );

function run( scenario: string, sessionId?: string, timeoutMs = 5000 ) {
	return runTurn( {
		text: 'ignored by the mock',
		sessionId,
		timeoutMs,
		cliEntry: mockCli,
		env: { ...process.env, SCENARIO: scenario, SESSION_ID: 'captured-sess' },
	} );
}

describe( 'runTurn', () => {
	it( 'captures session_id and result text on a successful turn', async () => {
		const outcome = await run( 'success' );
		expect( outcome.status ).toBe( 'success' );
		expect( outcome.sessionId ).toBe( 'captured-sess' );
		expect( outcome.replyText ).toBe( 'All done!' );
		expect( outcome.isError ).toBe( false );
		expect( outcome.exitCode ).toBe( 0 );
		expect( outcome.staleSession ).toBe( false );
	} );

	it( 'captures paused status and flattened questions', async () => {
		const outcome = await run( 'paused' );
		expect( outcome.status ).toBe( 'paused' );
		expect( outcome.sessionId ).toBe( 'captured-sess' );
		expect( outcome.questions ).toEqual( [
			{
				question: 'Pick one',
				options: [
					{ label: 'A', description: 'first' },
					{ label: 'B', description: 'second' },
				],
			},
		] );
	} );

	it( 'surfaces errors via errors[] when result is missing', async () => {
		const outcome = await run( 'error' );
		expect( outcome.status ).toBe( 'error' );
		expect( outcome.isError ).toBe( true );
		expect( outcome.replyText ).toBe( 'boom' );
		expect( outcome.exitCode ).toBe( 1 );
	} );

	it( 'falls back to last assistant text when agent_end has no reply text', async () => {
		const outcome = await run( 'empty-result-with-text' );
		expect( outcome.status ).toBe( 'success' );
		expect( outcome.isError ).toBe( false );
		expect( outcome.replyText ).toBe( 'Final answer from assistant.' );
		expect( outcome.exitCode ).toBe( 0 );
	} );

	it( 'detects a stale --resume-session via stderr pattern', async () => {
		const outcome = await run( 'stale-resume', 'bogus-sess-id' );
		expect( outcome.staleSession ).toBe( true );
		expect( outcome.stderrTail ).toMatch( /No AI session found/ );
		expect( outcome.exitCode ).toBe( 1 );
	} );

	it( 'detects a stale --resume-session via JSON error event', async () => {
		const outcome = await run( 'stale-resume-error-event', 'bogus-sess-id' );
		expect( outcome.staleSession ).toBe( true );
		expect( outcome.exitCode ).toBe( 1 );
		expect( outcome.stderrTail ).toBe( '' );
	} );

	it( 'times out and kills the child when it never emits turn.completed', async () => {
		const outcome = await run( 'hang', undefined, 400 );
		expect( outcome.status ).toBe( 'timeout' );
	}, 10_000 );

	it( 'forwards media.share events to the onEvent callback for in-flight delivery', async () => {
		const seen: string[] = [];
		const outcome = await runTurn( {
			text: 'ignored',
			timeoutMs: 5000,
			cliEntry: mockCli,
			env: { ...process.env, SCENARIO: 'media-share', SESSION_ID: 'captured-sess' },
			onEvent: ( event ) => {
				if ( event.type === 'media.share' ) {
					seen.push( event.dataBase64 );
				}
			},
		} );
		expect( outcome.status ).toBe( 'success' );
		expect( outcome.replyText ).toBe( 'Want me to publish this as a preview site?' );
		// Events are forwarded in emit order; the streamer (not the runner) is
		// responsible for actually posting them, so the outcome itself stays clean.
		expect( seen ).toEqual( [ 'AAAA', 'BBBB' ] );
	} );
} );
