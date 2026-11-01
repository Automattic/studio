import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { createFakeHostWithSites } from '@studio/agent/node/tests/fake-host';
import { bindTool } from '@studio/agent/node/tools/define-tool';
import { generateImagesTool } from '@studio/agent/node/tools/generate-images';

const STUDIO_SITES_ROOT = path.resolve( '/sites' );
const SITE = path.join( STUDIO_SITES_ROOT, 'studio-test-oak' );
// A site created in a folder of its own, outside the sites root.
const OWN_FOLDER_SITE = path.resolve( '/projects/bakery' );
const host = createFakeHostWithSites(
	[
		{ id: 'oak', name: 'Oak', path: SITE },
		{ id: 'bakery', name: 'Bakery', path: OWN_FOLDER_SITE },
	],
	STUDIO_SITES_ROOT
);

// Each image fails, so nothing is written to the sites root.
vi.mock( '@studio/agent/node/image-generation', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/agent/node/image-generation') >() ),
	isImageGenerationAvailable: async () => true,
	generateImages: async ( _userAgent: string, requests: unknown[] ) =>
		requests.map( () => ( { ok: false, error: 'not generated' } ) ),
} ) );

describe( 'the files images generating in the background will be', () => {
	it.each< { name: string; paths: string[]; files: string[]; folder?: string } >( [
		{
			name: 'are named as paths in their site',
			paths: [
				`${ SITE }/wp-content/themes/oak/assets/a.png`,
				`${ SITE }/wp-content/themes/oak/b.png`,
			],
			files: [ 'wp-content/themes/oak/assets/a.png', 'wp-content/themes/oak/b.png' ],
			folder: SITE,
		},
		{
			name: 'are named as paths in a site in a folder of its own',
			paths: [ `${ OWN_FOLDER_SITE }/wp-content/themes/bakery/a.png` ],
			files: [ 'wp-content/themes/bakery/a.png' ],
			folder: OWN_FOLDER_SITE,
		},
		{
			name: 'are named by their absolute paths outside any site',
			paths: [ `${ STUDIO_SITES_ROOT }/elsewhere/a.png` ],
			files: [ `${ STUDIO_SITES_ROOT }/elsewhere/a.png` ],
		},
	] )( '$name', async ( { paths, files, folder } ) => {
		const result = await bindTool( generateImagesTool, host ).rawHandler( {
			images: paths.map( ( p ) => ( { path: p, subject: 'a bench' } ) ),
		} as never );
		expect( result.pendingFiles ).toEqual(
			files.map( ( file ) => file.split( '/' ).join( path.sep ) )
		);
		expect( result.pendingFolder ).toBe( folder );
		expect( await result.pending ).toContain( 'not generated' );
	} );
} );
