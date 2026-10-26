import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { generateImagesTool } from 'cli/ai/tools/generate-images';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';

const SITE = path.join( STUDIO_SITES_ROOT, 'studio-test-oak' );

vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );
vi.mock( 'cli/lib/cli-config/core', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/cli-config/core') >() ),
	readCliConfig: async () => ( { sites: [ { id: 'oak', name: 'Oak', path: SITE } ] } ),
} ) );
// Each image fails, so nothing is written to the sites root.
vi.mock( 'cli/ai/image-generation', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/ai/image-generation') >() ),
	isImageGenerationAvailable: async () => true,
	generateImages: async ( requests: unknown[] ) =>
		requests.map( () => ( { ok: false, error: 'not generated' } ) ),
} ) );

describe( 'the files images generating in the background will be', () => {
	it.each< { name: string; paths: string[]; files: string[] } >( [
		{
			name: 'are named as paths in their site',
			paths: [
				`${ SITE }/wp-content/themes/oak/assets/a.png`,
				`${ SITE }/wp-content/themes/oak/b.png`,
			],
			files: [ 'wp-content/themes/oak/assets/a.png', 'wp-content/themes/oak/b.png' ],
		},
		{
			name: 'are named by their absolute paths outside any site',
			paths: [ `${ STUDIO_SITES_ROOT }/elsewhere/a.png` ],
			files: [ `${ STUDIO_SITES_ROOT }/elsewhere/a.png` ],
		},
	] )( '$name', async ( { paths, files } ) => {
		const result = await generateImagesTool.rawHandler( {
			images: paths.map( ( p ) => ( { path: p, subject: 'a bench' } ) ),
		} as never );
		expect( result.pendingFiles ).toEqual(
			files.map( ( file ) => file.split( '/' ).join( path.sep ) )
		);
		expect( await result.pending ).toContain( 'not generated' );
	} );
} );
