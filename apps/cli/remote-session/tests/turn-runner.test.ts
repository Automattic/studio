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

	it( 'detects a stale --resume-session via stderr pattern', async () => {
		const outcome = await run( 'stale-resume', 'bogus-sess-id' );
		expect( outcome.staleSession ).toBe( true );
		expect( outcome.stderrTail ).toMatch( /No AI session found/ );
		expect( outcome.exitCode ).toBe( 1 );
	} );

	it( 'times out and kills the child when it never emits turn.completed', async () => {
		const outcome = await run( 'hang', undefined, 400 );
		expect( outcome.status ).toBe( 'timeout' );
	}, 10_000 );

	it( 'collects media.share events in emit order alongside the reply text', async () => {
		const outcome = await run( 'media-share' );
		expect( outcome.status ).toBe( 'success' );
		expect( outcome.replyText ).toBe( 'Want me to publish this as a preview site?' );
		expect( outcome.mediaShares ).toEqual( [
			{
				mediaType: 'image',
				mimeType: 'image/png',
				dataBase64: 'AAAA',
				caption: 'Site preview',
			},
			{
				mediaType: 'image',
				mimeType: 'image/png',
				dataBase64: 'BBBB',
				caption: undefined,
			},
		] );
	} );
} );
