import os from 'node:os';
import path from 'node:path';
import { downloadAndExtractBlueprintBundle } from '@studio/common/lib/blueprint-bundle';
import { fetchStudioBlueprints } from '@studio/common/lib/studio-blueprints-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLocalServer, type LocalServer } from '../index';

vi.mock( '@studio/common/lib/studio-blueprints-api' );
vi.mock( '@studio/common/lib/blueprint-bundle', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/blueprint-bundle') >() ),
	downloadAndExtractBlueprintBundle: vi.fn(),
} ) );

const CATALOG_BUNDLE_URL = 'https://blueprintlibrary.wordpress.com/?blueprint=825';

let server: LocalServer;

beforeEach( async () => {
	vi.clearAllMocks();
	vi.mocked( fetchStudioBlueprints ).mockResolvedValue( [
		{
			slug: 'gaming-news',
			title: 'Gaming news',
			excerpt: '',
			image: '',
			playground_url: '',
			blueprint: {},
			bundle_url: CATALOG_BUNDLE_URL,
		},
	] );
	const tempDir = path.join( os.tmpdir(), 'studio-blueprint-bundle-route-test' );
	vi.mocked( downloadAndExtractBlueprintBundle ).mockResolvedValue( {
		tempDir,
		blueprintJsonPath: path.join( tempDir, 'blueprint.json' ),
	} );
	server = await startLocalServer( {
		cliBinary: path.join( os.tmpdir(), 'studio-test-cli.mjs' ),
		sessionsRoot: path.join( os.tmpdir(), 'studio-test-sessions' ),
		sitesRoot: path.join( os.tmpdir(), 'studio-test-sites' ),
		port: 0,
	} );
} );

afterEach( async () => {
	await server.close();
} );

describe( 'POST /api/sites with a blueprint bundle', () => {
	it.each( [
		[ 'downloads a bundle listed in the catalog', CATALOG_BUNDLE_URL, true ],
		[ 'refuses a bundle the catalog does not list', 'http://169.254.169.254/latest', false ],
	] )( '%s', async ( _label, bundleUrl, downloaded ) => {
		const response = await fetch( `${ server.url }/api/sites`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( {
				name: 'Gaming news',
				path: path.join( os.tmpdir(), 'studio-test-sites', 'gaming-news' ),
				blueprint: { blueprint: {}, bundleUrl },
			} ),
		} );

		if ( downloaded ) {
			expect( downloadAndExtractBlueprintBundle ).toHaveBeenCalledWith( CATALOG_BUNDLE_URL );
		} else {
			expect( response.status ).toBe( 400 );
			expect( downloadAndExtractBlueprintBundle ).not.toHaveBeenCalled();
		}
	} );
} );
