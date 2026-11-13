import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { getSitePublishStatus } from '@studio/common/sites/publish-status';
import { getSiteVisibility, setSiteVisibility } from '@studio/common/sites/remote-sites';
import { getProvider } from '@studio/providers/services';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startLocalServer, type LocalServer } from '../index';

vi.mock( '@studio/common/sites/remote-sites' );
vi.mock( '@studio/common/sites/publish-status' );
vi.mock( '@studio/common/lib/shared-config', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/shared-config') >() ),
	readAuthToken: vi.fn(),
} ) );
let server: LocalServer;
let configDir: string;
const details = {
	visibility: 'coming-soon' as const,
	url: 'https://example.blog',
	launchStatus: 'launched',
};
beforeEach( async () => {
	vi.clearAllMocks();
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-visibility-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', configDir );
	vi.mocked( readAuthToken ).mockResolvedValue( { accessToken: 'test-token' } as Awaited<
		ReturnType< typeof readAuthToken >
	> );
	vi.mocked( getSiteVisibility ).mockResolvedValue( details );
	vi.mocked( setSiteVisibility ).mockResolvedValue( details );
	server = await startLocalServer( {
		cliBinary: path.join( configDir, 'cli.mjs' ),
		sessionsRoot: path.join( configDir, 'sessions' ),
		sitesRoot: path.join( configDir, 'sites' ),
		port: 0,
	} );
} );
afterEach( async () => {
	await server.close();
	vi.unstubAllEnvs();
	rmSync( configDir, { recursive: true, force: true } );
} );
it( 'uses the shared visibility implementation for reads and writes', async () => {
	const url = `${ server.url }/api/wpcom/sites/42/visibility`;
	expect( await ( await fetch( url ) ).json() ).toEqual( details );
	const response = await fetch( url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( { visibility: 'coming-soon' } ),
	} );
	expect( response.status ).toBe( 200 );
	expect( await response.json() ).toEqual( details );
	expect( getSiteVisibility ).toHaveBeenCalledWith( getProvider( 'wpcom' ), 42 );
	expect( setSiteVisibility ).toHaveBeenCalledWith( getProvider( 'wpcom' ), 42, 'coming-soon' );
} );
it( 'rejects invalid settings and unauthenticated writes', async () => {
	const url = `${ server.url }/api/wpcom/sites/42/visibility`;
	const options = {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( { visibility: 'link' } ),
	};
	expect( ( await fetch( url, options ) ).status ).toBe( 400 );
	vi.mocked( readAuthToken ).mockResolvedValue( null );
	expect( ( await fetch( url, options ) ).status ).toBe( 401 );
	expect( setSiteVisibility ).not.toHaveBeenCalled();
} );

it( 'delegates local publishing comparisons to the same CLI implementation as desktop', async () => {
	vi.mocked( getSitePublishStatus ).mockResolvedValue( { localChanged: false } );
	const response = await fetch( `${ server.url }/api/sites/local/publish-status/42` );
	expect( response.status ).toBe( 200 );
	expect( await response.json() ).toEqual( { localChanged: false } );
	expect( getSitePublishStatus ).toHaveBeenCalledWith(
		expect.any( Function ),
		'local',
		'42',
		'wpcom'
	);
} );

it( 'routes provider visibility through the shared service', async () => {
	const url = `${ server.url }/api/remote-sites/wpcom/42/visibility`;
	expect( await ( await fetch( url ) ).json() ).toEqual( details );
	const response = await fetch( url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( { visibility: 'public' } ),
	} );
	expect( response.status ).toBe( 200 );
	expect( getSiteVisibility ).toHaveBeenCalledWith( getProvider( 'wpcom' ), '42' );
	expect( setSiteVisibility ).toHaveBeenCalledWith( getProvider( 'wpcom' ), '42', 'public' );
} );

it( 'routes Spacefast restricted access and choice availability without losing metadata', async () => {
	const spaceDetails = {
		visibility: 'private' as const,
		url: 'https://example.space.fast',
		availableValues: [ 'private' as const ],
		message: 'Your team only allows restricted sites.',
	};
	vi.mocked( getSiteVisibility ).mockResolvedValue( spaceDetails );
	vi.mocked( setSiteVisibility ).mockResolvedValue( spaceDetails );
	const url = `${ server.url }/api/remote-sites/spacefast/spc_1/visibility`;
	expect( await ( await fetch( url ) ).json() ).toEqual( spaceDetails );
	const response = await fetch( url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( { visibility: 'private' } ),
	} );
	expect( response.status ).toBe( 200 );
	expect( await response.json() ).toEqual( spaceDetails );
	expect( getSiteVisibility ).toHaveBeenCalledWith( getProvider( 'spacefast' ), 'spc_1' );
	expect( setSiteVisibility ).toHaveBeenCalledWith(
		getProvider( 'spacefast' ),
		'spc_1',
		'private'
	);
} );
