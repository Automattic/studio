import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPreviewChangeDetector } from 'cli/ai/runtimes/pi/preview-reload';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

const agentEnd = { type: 'agent_end', messages: [], willRetry: false } as AgentSessionEvent;
const retryingEnd = { type: 'agent_end', messages: [], willRetry: true } as AgentSessionEvent;
const turnEnd = { type: 'turn_end' } as AgentSessionEvent;

let site: string;
let clock: number;

// Writes a file with an mtime later than anything written before it.
function write( relativePath: string, content = 'x' ) {
	const file = path.join( site, relativePath );
	mkdirSync( path.dirname( file ), { recursive: true } );
	writeFileSync( file, content );
	clock += 10;
	utimesSync( file, clock, clock );
}

beforeEach( () => {
	site = mkdtempSync( path.join( tmpdir(), 'preview-reload-' ) );
	clock = Math.floor( Date.now() / 1000 );
	write( 'wp-content/database/.ht.sqlite' );
	write( 'wp-content/themes/twentytwentyfive/style.css' );
} );

afterEach( () => rmSync( site, { recursive: true, force: true } ) );

describe( 'createPreviewChangeDetector', () => {
	it( 'reports a request that changed a theme file, plugin, upload or the database', () => {
		for ( const file of [
			'wp-content/themes/twentytwentyfive/style.css',
			'wp-content/plugins/new/new.php',
			'wp-content/uploads/hero.png',
			'wp-content/database/.ht.sqlite',
		] ) {
			const changed = createPreviewChangeDetector( () => site );
			write( file );
			expect( changed( agentEnd ) ).toBe( true );
		}
	} );

	it( 'reports once, when the request ends, not after each turn or before a retry', () => {
		const changed = createPreviewChangeDetector( () => site );
		write( 'wp-content/themes/twentytwentyfive/style.css' );
		expect( changed( turnEnd ) ).toBe( false );
		expect( changed( retryingEnd ) ).toBe( false );
		expect( changed( agentEnd ) ).toBe( true );
	} );

	it( 'does not report a request that left wp-content untouched', () => {
		const changed = createPreviewChangeDetector( () => site );
		write( 'DESIGN.md' );
		expect( changed( agentEnd ) ).toBe( false );
	} );

	it( 'does not report without a local site', () => {
		const changed = createPreviewChangeDetector( () => undefined );
		expect( changed( agentEnd ) ).toBe( false );
	} );

	it( 'reports a site the agent made active during the request', () => {
		const active: { path?: string } = {};
		const changed = createPreviewChangeDetector( () => active.path );
		active.path = site;
		expect( changed( agentEnd ) ).toBe( true );
	} );
} );
