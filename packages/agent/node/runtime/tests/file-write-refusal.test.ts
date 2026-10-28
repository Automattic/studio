import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getFileWriteRefusal } from '@studio/agent/node/runtime/tool-safety';
import { buildSystemPrompt } from '@studio/agent/node/system-prompt';

let root: string;
const studioSite = () => path.join( root, 'my-site' );
const unmanaged = () => path.join( root, 'wordpress-develop', 'src' );
const isStudioSite = async ( folder: string ) => arePathsEqual( folder, studioSite() );

function makeWordPressTree( dir: string ) {
	mkdirSync( path.join( dir, 'wp-includes' ), { recursive: true } );
	mkdirSync( path.join( dir, 'wp-content' ), { recursive: true } );
}

beforeEach( () => {
	root = mkdtempSync( path.join( os.tmpdir(), 'studio-core-guard-' ) );
	makeWordPressTree( studioSite() );
	makeWordPressTree( unmanaged() );
} );

afterEach( () => {
	rmSync( root, { recursive: true, force: true } );
} );

describe( 'getFileWriteRefusal', () => {
	it.each( [
		'my-site/wp-includes/functions.php',
		'my-site/wp-admin/includes/file.php',
		'my-site/wp-settings.php',
		'my-site/index.php',
		'my-site/xmlrpc.php',
	] )( "refuses a Studio site's core file %s, naming wp-content", async ( file ) => {
		for ( const tool of [ 'Write', 'Edit' ] ) {
			const refusal = await getFileWriteRefusal( tool, { path: file }, root, isStudioSite );
			expect( refusal ).toContain( 'wp-content/' );
		}
	} );

	it( 'resolves absolute paths too', async () => {
		const file = path.join( studioSite(), 'wp-includes', 'version.php' );
		expect( await getFileWriteRefusal( 'Edit', { path: file }, '/', isStudioSite ) ).toContain(
			"wp-includes/version.php is this Studio site's copy of WordPress core"
		);
	} );

	it.each( [
		'my-site/wp-config.php',
		'my-site/wp-content/themes/acme/functions.php',
		'my-site/wp-content/plugins/wp-includes/x.php',
		'my-site/DESIGN.md',
		'elsewhere/wp-includes/functions.php',
		// A WordPress tree that Studio doesn't manage.
		'wordpress-develop/src/wp-includes/functions.php',
		'wordpress-develop/src/wp-admin/includes/file.php',
	] )( 'allows %s', async ( file ) => {
		expect(
			await getFileWriteRefusal( 'Write', { path: file }, root, isStudioSite )
		).toBeUndefined();
	} );

	it( 'only guards Write and Edit', async () => {
		expect(
			await getFileWriteRefusal(
				'Read',
				{ path: 'my-site/wp-includes/functions.php' },
				root,
				isStudioSite
			)
		).toBeUndefined();
	} );
} );

describe( 'core file rule in the prompt', () => {
	it( 'is left to the tools, for Studio Code and external agents alike', () => {
		for ( const prompt of [ buildSystemPrompt( {} ), buildSystemPrompt( { external: true } ) ] ) {
			expect( prompt ).not.toMatch( /WordPress core|core files/ );
		}
	} );
} );
