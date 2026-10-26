import os from 'node:os';
import path from 'node:path';
import { downloadAndExtractBlueprintBundle } from '@studio/common/lib/blueprint-bundle';
import { fetchStudioBlueprints, type Blueprint } from '@studio/common/lib/studio-blueprints-api';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { startLocalServer, type LocalServer } from '../index';

vi.mock( '@studio/common/lib/studio-blueprints-api' );
vi.mock( '@studio/common/lib/blueprint-bundle', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	downloadAndExtractBlueprintBundle: vi.fn( async () => ( {
		tempDir: '',
		blueprintJsonPath: '',
	} ) ),
} ) );

const CATALOG_URL = 'https://blueprintlibrary.wordpress.com/?blueprint=825';
const tmp = ( name: string ) => path.join( os.tmpdir(), `studio-test-${ name }` );
let server: LocalServer;

beforeAll( async () => {
	vi.mocked( fetchStudioBlueprints ).mockResolvedValue( [
		{ bundle_url: CATALOG_URL } as Blueprint,
	] );
	server = await startLocalServer( {
		cliBinary: tmp( 'cli.mjs' ),
		sessionsRoot: tmp( 'sessions' ),
		sitesRoot: tmp( 'sites' ),
		port: 0,
	} );
} );

afterAll( () => server.close() );

it.each( [
	[ CATALOG_URL, true ],
	[ 'http://169.254.169.254/latest', false ],
] )( 'POST /api/sites with bundleUrl %s downloads it: %s', async ( bundleUrl, downloaded ) => {
	vi.mocked( downloadAndExtractBlueprintBundle ).mockClear();
	const response = await fetch( `${ server.url }/api/sites`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( { name: 'A', path: tmp( 'sites/a' ), blueprint: { bundleUrl } } ),
	} );

	expect( vi.mocked( downloadAndExtractBlueprintBundle ).mock.calls ).toEqual(
		downloaded ? [ [ CATALOG_URL ] ] : []
	);
	expect( response.status === 400 ).toBe( ! downloaded );
} );
