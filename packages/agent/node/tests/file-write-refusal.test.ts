import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeHost, fakeSite } from '@studio/agent/node/tests/fake-host';
import { buildSystemPrompt } from '@studio/agent/shared/system-prompt';
import { getFileWriteRefusal } from '@studio/agent/shared/tool-safety';
import type { StudioAgentHost } from '@studio/agent/shared/host';

let root: string;
let host: StudioAgentHost;
const studioSite = () => path.join( root, 'my-site' );
const unmanaged = () => path.join( root, 'wordpress-develop', 'src' );
const refusal = ( tool: string, file: string ) =>
	getFileWriteRefusal( tool, { path: file }, host, ( target ) => path.resolve( root, target ) );

function makeWordPressTree( dir: string ) {
	mkdirSync( path.join( dir, 'wp-includes' ), { recursive: true } );
	mkdirSync( path.join( dir, 'wp-content' ), { recursive: true } );
}

beforeEach( () => {
	root = mkdtempSync( path.join( os.tmpdir(), 'studio-core-guard-' ) );
	makeWordPressTree( studioSite() );
	makeWordPressTree( unmanaged() );
	host = createFakeHost( root );
	vi.mocked( host.sites.findByFolder ).mockImplementation( async ( folder ) =>
		arePathsEqual( folder, studioSite() ) ? fakeSite : undefined
	);
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
			expect( await refusal( tool, file ) ).toContain( 'wp-content/' );
		}
	} );

	it( 'resolves absolute paths too', async () => {
		const file = path.join( studioSite(), 'wp-includes', 'version.php' );
		expect( await refusal( 'Edit', file ) ).toContain(
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
		expect( await refusal( 'Write', file ) ).toBeUndefined();
	} );

	it( 'only guards Write and Edit', async () => {
		expect( await refusal( 'Read', 'my-site/wp-includes/functions.php' ) ).toBeUndefined();
	} );
} );

describe( 'core file rule in the prompt', () => {
	it( 'is left to the tools, for Studio Code and external agents alike', () => {
		for ( const prompt of [ buildSystemPrompt( {} ), buildSystemPrompt( { external: true } ) ] ) {
			expect( prompt ).not.toMatch( /WordPress core|core files/ );
		}
	} );
} );
