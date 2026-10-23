import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFileWriteRefusal } from 'cli/ai/runtimes/pi/tool-safety';
import { findSiteByFolder } from 'cli/lib/cli-config/sites';

vi.mock( 'cli/lib/cli-config/sites', () => ( { findSiteByFolder: vi.fn() } ) );

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
	for ( const [ theme, header ] of [
		[ 'twentytwentyfive', 'Theme Name: Twenty Twenty-Five' ],
		[ 'mine', 'Theme Name: Mine\nDescription: A custom block theme scaffolded by Studio Code.' ],
	] ) {
		const dir = path.join( studioSite(), 'wp-content', 'themes', theme );
		mkdirSync( dir, { recursive: true } );
		writeFileSync( path.join( dir, 'style.css' ), `/*\n${ header }\n*/` );
	}
} );

afterEach( () => {
	rmSync( root, { recursive: true, force: true } );
	vi.mocked( findSiteByFolder ).mockReset();
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

	it( "refuses an installed theme's files, naming a child theme", async () => {
		expect(
			await getFileWriteRefusal(
				'Edit',
				{ path: 'my-site/wp-content/themes/twentytwentyfive/parts/header.html' },
				root,
				isStudioSite
			)
		).toContain( 'scaffold_theme (parentTheme: "twentytwentyfive")' );
	} );

	it( 'resolves absolute paths too', async () => {
		const file = path.join( studioSite(), 'wp-includes', 'version.php' );
		expect( await getFileWriteRefusal( 'Edit', { path: file }, '/', isStudioSite ) ).toContain(
			"wp-includes/version.php is this Studio site's copy of WordPress core"
		);
	} );

	it.each( [
		'my-site/wp-config.php',
		// A theme without style.css is being created.
		'my-site/wp-content/themes/acme/functions.php',
		// Themes Studio Code scaffolded.
		'my-site/wp-content/themes/mine/parts/header.html',
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

	it( "asks Studio's site list by default", async () => {
		vi.mocked( findSiteByFolder ).mockImplementation( async ( folder ) =>
			arePathsEqual( folder, studioSite() )
				? ( { id: 'site', name: 'My Site', path: studioSite() } as Awaited<
						ReturnType< typeof findSiteByFolder >
				  > )
				: undefined
		);
		expect(
			await getFileWriteRefusal( 'Edit', { path: 'my-site/wp-includes/functions.php' }, root )
		).toContain( 'WordPress core' );
		expect(
			await getFileWriteRefusal(
				'Edit',
				{ path: 'wordpress-develop/src/wp-includes/functions.php' },
				root
			)
		).toBeUndefined();
	} );
} );
