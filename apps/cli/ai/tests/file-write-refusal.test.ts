import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getFileWriteRefusal } from 'cli/ai/runtimes/pi/tool-safety';
import { buildSystemPrompt } from 'cli/ai/system-prompt';

let root: string;
const site = () => path.join( root, 'my-site' );

beforeEach( () => {
	root = mkdtempSync( path.join( os.tmpdir(), 'studio-core-guard-' ) );
	mkdirSync( path.join( site(), 'wp-includes' ), { recursive: true } );
	mkdirSync( path.join( site(), 'wp-content' ), { recursive: true } );
} );

afterEach( () => rmSync( root, { recursive: true, force: true } ) );

describe( 'getFileWriteRefusal', () => {
	it.each( [
		'my-site/wp-includes/functions.php',
		'my-site/wp-admin/includes/file.php',
		'my-site/wp-settings.php',
		'my-site/index.php',
		'my-site/xmlrpc.php',
	] )( 'refuses core file %s, naming wp-content', ( file ) => {
		for ( const tool of [ 'Write', 'Edit' ] ) {
			expect( getFileWriteRefusal( tool, { path: file }, root ) ).toContain( 'wp-content/' );
		}
	} );

	it( 'resolves absolute paths too', () => {
		const file = path.join( site(), 'wp-includes', 'version.php' );
		expect( getFileWriteRefusal( 'Edit', { path: file }, '/' ) ).toContain(
			'wp-includes/version.php is WordPress core'
		);
	} );

	it.each( [
		'my-site/wp-config.php',
		'my-site/wp-content/themes/acme/functions.php',
		'my-site/wp-content/plugins/wp-includes/x.php',
		'my-site/DESIGN.md',
		'elsewhere/wp-includes/functions.php',
	] )( 'allows %s', ( file ) => {
		expect( getFileWriteRefusal( 'Write', { path: file }, root ) ).toBeUndefined();
	} );

	it( 'only guards Write and Edit', () => {
		expect(
			getFileWriteRefusal( 'Read', { path: 'my-site/wp-includes/functions.php' }, root )
		).toBeUndefined();
	} );
} );

describe( 'core file rule in the prompt', () => {
	it( 'is text only for external agents, whose file tools Studio does not guard', () => {
		expect( buildSystemPrompt( { external: true } ) ).toContain( 'WordPress core (wp-includes/' );
		expect( buildSystemPrompt( {} ) ).not.toContain( 'WordPress core (wp-includes/' );
	} );
} );
