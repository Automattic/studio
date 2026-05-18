import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	RemoteSessionLogger,
	formatLogLineForStdout,
	redact,
	stripTerminalControls,
} from 'cli/remote-session/logger';

describe( 'remote-session logger redaction', () => {
	it( 'redacts Bearer tokens in arbitrary text', () => {
		expect( redact( 'Authorization: Bearer abc.def-ghi/jkl=' ) ).toBe(
			'Authorization: Bearer [redacted]'
		);
	} );

	it( 'redacts JSON token fields, tolerating whitespace around the separator', () => {
		expect( redact( '{"token":"hunter2"}' ) ).toBe( '{"token":"[redacted]"}' );
		// The surrounding whitespace outside the key/value is preserved verbatim.
		expect( redact( '{ "token" : "hunter2" }' ) ).toBe( '{ "token":"[redacted]" }' );
	} );

	it( 'leaves other text intact', () => {
		expect( redact( 'no secrets here' ) ).toBe( 'no secrets here' );
	} );
} );

describe( 'stripTerminalControls', () => {
	it( 'removes ANSI CSI sequences and bare ESC bytes', () => {
		expect( stripTerminalControls( '\x1b[2Jhello\x1b[31mworld\x1b[0m' ) ).toBe( 'helloworld' );
		expect( stripTerminalControls( 'before\x1bafter' ) ).toBe( 'beforeafter' );
	} );

	it( 'removes OSC hyperlink sequences', () => {
		expect( stripTerminalControls( '\x1b]8;;https://evil/\x07click\x1b]8;;\x07' ) ).toBe( 'click' );
	} );

	it( 'strips C0 and DEL but keeps tab and newline', () => {
		expect( stripTerminalControls( 'a\x07b\x7fc\nd\te' ) ).toBe( 'abc\nd\te' );
	} );
} );

describe( 'RemoteSessionLogger writes', () => {
	let tmpDir: string;
	let logPath: string;

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-remote-log-' ) );
		logPath = path.join( tmpDir, 'remote.log' );
	} );

	afterEach( () => {
		fs.rmSync( tmpDir, { recursive: true, force: true } );
		vi.restoreAllMocks();
	} );

	function captureStdout(): { writes: string[]; combined: () => string } {
		const writes: string[] = [];
		// `process.stdout.write` has overloads: `(chunk, cb?)` and `(chunk, encoding?, cb?)`.
		// Accept rest args and invoke any function-typed arg so internal Node/Vitest writers
		// that supply a callback don't hang waiting for it.
		vi.spyOn( process.stdout, 'write' ).mockImplementation( ( (
			chunk: unknown,
			...rest: unknown[]
		) => {
			writes.push(
				typeof chunk === 'string' ? chunk : Buffer.from( chunk as Uint8Array ).toString( 'utf8' )
			);
			const cb = rest.find( ( arg ): arg is ( err?: Error ) => void => typeof arg === 'function' );
			cb?.();
			return true;
		} ) as typeof process.stdout.write );
		return { writes, combined: () => writes.join( '' ) };
	}

	it( 'writes one line per call with redacted content', () => {
		const logger = new RemoteSessionLogger( { logPath } );
		logger.info( 'hello Bearer abc123', { token: 'visible-secret' } );
		const content = fs.readFileSync( logPath, 'utf8' );
		expect( content ).toMatch( /"msg":"hello Bearer \[redacted\]"/ );
		expect( content ).not.toMatch( /visible-secret/ );
		expect( content.split( '\n' ).filter( Boolean ) ).toHaveLength( 1 );
	} );

	it( 'suppresses debug entries unless STUDIO_REMOTE_DEBUG=1', () => {
		const original = process.env.STUDIO_REMOTE_DEBUG;
		try {
			delete process.env.STUDIO_REMOTE_DEBUG;
			const logger = new RemoteSessionLogger( { logPath } );
			logger.debug( 'should be suppressed' );
			expect( fs.existsSync( logPath ) ).toBe( false );

			process.env.STUDIO_REMOTE_DEBUG = '1';
			logger.debug( 'should land' );
			expect( fs.readFileSync( logPath, 'utf8' ) ).toMatch( /should land/ );
		} finally {
			if ( original === undefined ) {
				delete process.env.STUDIO_REMOTE_DEBUG;
			} else {
				process.env.STUDIO_REMOTE_DEBUG = original;
			}
		}
	} );

	it( 'mirrors non-debug entries to stdout when mirrorToStdout is set, with redaction', () => {
		const captured = captureStdout();
		const logger = new RemoteSessionLogger( { logPath, mirrorToStdout: true } );
		logger.info( 'hello Bearer abc123', { token: 'visible-secret', chat_id: 42 } );
		logger.warn( 'no meta here' );
		const combined = captured.combined();
		expect( combined ).toMatch( /\binfo\b.*hello Bearer \[redacted\].*"chat_id":42/ );
		expect( combined ).toMatch( /\bwarn\b.*no meta here/ );
		expect( combined ).not.toMatch( /visible-secret/ );
		// Sanity check: file path also got the line.
		expect( fs.readFileSync( logPath, 'utf8' ) ).toMatch( /"msg":"hello Bearer \[redacted\]"/ );
	} );

	it( 'event() persists to the log file and mirrors to stdout when enabled', () => {
		const captured = captureStdout();
		const logger = new RemoteSessionLogger( { logPath, mirrorToStdout: true } );
		logger.event( 'reply', 'Just 1 site is running.\nLine two.' );
		logger.event( 'progress', 'Authorization: Bearer abc.def' );
		const combined = captured.combined();
		// Newlines in content are indented so each line stays grouped under its event.
		expect( combined ).toMatch( /reply Just 1 site is running\.\n {2}Line two\./ );
		expect( combined ).toMatch( /progress Authorization: Bearer \[redacted\]/ );
		// File sink also receives the events (so attach can replay them).
		const fileContent = fs.readFileSync( logPath, 'utf8' );
		const lines = fileContent.split( '\n' ).filter( Boolean );
		expect( lines ).toHaveLength( 2 );
		const first = JSON.parse( lines[ 0 ] );
		expect( first.event ).toBe( 'reply' );
		expect( first.content ).toBe( 'Just 1 site is running.\nLine two.' );
		const second = JSON.parse( lines[ 1 ] );
		expect( second.event ).toBe( 'progress' );
		expect( second.content ).toBe( 'Authorization: Bearer [redacted]' );
	} );

	it( 'event() persists to the log file even when mirrorToStdout is off', () => {
		const captured = captureStdout();
		const logger = new RemoteSessionLogger( { logPath } );
		logger.event( 'reply', 'agent says hi' );
		expect( captured.combined() ).not.toMatch( /agent says hi/ );
		const lines = fs.readFileSync( logPath, 'utf8' ).split( '\n' ).filter( Boolean );
		expect( lines ).toHaveLength( 1 );
		const parsed = JSON.parse( lines[ 0 ] );
		expect( parsed.event ).toBe( 'reply' );
		expect( parsed.content ).toBe( 'agent says hi' );
	} );

	it( 'does not mirror to stdout by default', () => {
		const captured = captureStdout();
		const logger = new RemoteSessionLogger( { logPath } );
		logger.info( 'silent on stdout' );
		expect( captured.combined() ).not.toMatch( /silent on stdout/ );
	} );

	it( 'sanitizes terminal control sequences from untrusted content on stdout', () => {
		const captured = captureStdout();
		const logger = new RemoteSessionLogger( { logPath, mirrorToStdout: true } );
		// Raw ESC + CSI screen-clear, plus an OSC hyperlink wrapping evil text.
		logger.event( 'message', '\x1b[2Jcleared\nhello\x1b]8;;https://evil/\x07click\x1b]8;;\x07' );
		// info() goes through formatStdoutLine; its meta values must also be neutralized.
		logger.info( 'Polled message', { preview: '\x1b[31mred\x1b[0m\x07' } );
		const combined = captured.combined();
		// No raw ESC, BEL, or other C0/DEL bytes (apart from \t/\n) leak through.
		// eslint-disable-next-line no-control-regex
		expect( combined ).not.toMatch( /[\x00-\x08\x0B-\x1F\x7F]/ );
		expect( combined ).toContain( 'message cleared' );
		expect( combined ).toContain( 'click' );
		// JSON.stringify already escapes raw ESC bytes to the visible 6-char `\u001b` (literal backslash-u-0-0-1-b)
		// sequence in meta, so the terminal sees inert text rather than active escapes.
		expect( combined ).toContain( '\\u001b[31mred\\u001b[0m\\u0007' );
	} );
} );

describe( 'formatLogLineForStdout', () => {
	it( 'renders persisted event lines in [time] kind content shape', () => {
		const line =
			JSON.stringify( {
				t: '2026-05-05T12:34:56.000Z',
				event: 'reply',
				content: 'Hello world.\nLine two.',
			} ) + '\n';
		const out = formatLogLineForStdout( line );
		expect( out ).toBe( '[12:34:56] reply Hello world.\n  Line two.\n' );
	} );

	it( 'sanitizes terminal control sequences in event content', () => {
		const line =
			JSON.stringify( {
				t: '2026-05-05T12:34:56.000Z',
				event: 'progress',
				content: '\x1b[2Jcleared',
			} ) + '\n';
		const out = formatLogLineForStdout( line );
		// eslint-disable-next-line no-control-regex
		expect( out ).not.toMatch( /[\x00-\x08\x0B-\x1F\x7F]/ );
		expect( out ).toContain( 'progress cleared' );
	} );
} );
