import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPreviewChangeDetector } from 'cli/ai/runtimes/pi/preview-reload';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

const turnStart = { type: 'turn_start' } as AgentSessionEvent;
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
	it( 'reports a turn that changed a theme file, plugin, upload or the database', () => {
		const changed = createPreviewChangeDetector( () => site );
		for ( const file of [
			'wp-content/themes/twentytwentyfive/style.css',
			'wp-content/plugins/new/new.php',
			'wp-content/uploads/hero.png',
			'wp-content/database/.ht.sqlite',
		] ) {
			changed( turnStart );
			write( file );
			expect( changed( turnEnd ) ).toBe( true );
		}
	} );

	it( 'does not report a turn that left wp-content untouched', () => {
		const changed = createPreviewChangeDetector( () => site );
		changed( turnStart );
		write( 'DESIGN.md' );
		expect( changed( turnEnd ) ).toBe( false );
	} );

	it( 'does not report without a local site, or when the site changed mid-turn', () => {
		const none = createPreviewChangeDetector( () => undefined );
		none( turnStart );
		expect( none( turnEnd ) ).toBe( false );

		let current = site;
		const switched = createPreviewChangeDetector( () => current );
		switched( turnStart );
		write( 'wp-content/themes/twentytwentyfive/style.css' );
		current = path.join( site, 'other' );
		expect( switched( turnEnd ) ).toBe( false );
	} );
} );
