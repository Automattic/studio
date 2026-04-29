import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RemoteSessionLogger, redact } from 'cli/remote-session/logger';

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

describe( 'RemoteSessionLogger writes', () => {
	let tmpDir: string;
	let logPath: string;

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-remote-log-' ) );
		logPath = path.join( tmpDir, 'remote.log' );
	} );

	afterEach( () => {
		fs.rmSync( tmpDir, { recursive: true, force: true } );
	} );

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
		const writes: string[] = [];
		const originalWrite = process.stdout.write.bind( process.stdout );
		process.stdout.write = ( ( chunk: string | Uint8Array ) => {
			writes.push( typeof chunk === 'string' ? chunk : Buffer.from( chunk ).toString( 'utf8' ) );
			return true;
		} ) as typeof process.stdout.write;
		try {
			const logger = new RemoteSessionLogger( { logPath, mirrorToStdout: true } );
			logger.info( 'hello Bearer abc123', { token: 'visible-secret', chat_id: 42 } );
			logger.warn( 'no meta here' );
		} finally {
			process.stdout.write = originalWrite;
		}
		const combined = writes.join( '' );
		expect( combined ).toMatch( /\binfo\b.*hello Bearer \[redacted\].*"chat_id":42/ );
		expect( combined ).toMatch( /\bwarn\b.*no meta here/ );
		expect( combined ).not.toMatch( /visible-secret/ );
		// Sanity check: file path also got the line.
		expect( fs.readFileSync( logPath, 'utf8' ) ).toMatch( /"msg":"hello Bearer \[redacted\]"/ );
	} );

	it( 'does not mirror to stdout by default', () => {
		const writes: string[] = [];
		const originalWrite = process.stdout.write.bind( process.stdout );
		process.stdout.write = ( ( chunk: string | Uint8Array ) => {
			writes.push( typeof chunk === 'string' ? chunk : Buffer.from( chunk ).toString( 'utf8' ) );
			return true;
		} ) as typeof process.stdout.write;
		try {
			const logger = new RemoteSessionLogger( { logPath } );
			logger.info( 'silent on stdout' );
		} finally {
			process.stdout.write = originalWrite;
		}
		expect( writes.join( '' ) ).not.toMatch( /silent on stdout/ );
	} );
} );
