import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { spacefast } from 'cli/ai/spacefast-host';
import { captureLocalSite } from 'cli/lib/data-liberation-client';

vi.mock( 'cli/commands/site/start', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/lib/data-liberation-client', () => ( { captureLocalSite: vi.fn() } ) );

const site = {
	id: 'site-1',
	name: 'Juniper',
	path: '/sites/juniper',
	url: 'http://localhost:8884',
	phpVersion: '8.4',
};
const publish = vi.fn();

beforeEach( () => {
	vi.stubEnv( 'DEV_CONFIG_DIR', fs.mkdtempSync( path.join( os.tmpdir(), 'studio-spacefast-' ) ) );
	vi.stubEnv( 'SPACEFAST_TOKEN', '' );
	vi.spyOn( console, 'log' ).mockImplementation( () => {} );
	vi.mocked( captureLocalSite ).mockResolvedValue( { websiteDir: '/copy/website', publish } );
} );

afterEach( () => {
	vi.unstubAllEnvs();
	publish.mockReset();
} );

const push = ( target: string ) => spacefast.push( site, target, 'all', () => {} );

it( 'publishes a site to a new space, then again to that space with its claim key', async () => {
	expect( ( await spacefast.targets( site ) ).targets ).toEqual( [
		expect.objectContaining( { id: 'new' } ),
	] );

	publish.mockResolvedValueOnce( {
		liveUrl: 'https://indigo-hill.space.fast/',
		spaceId: 'spc_1',
		private: true,
		claim: { url: 'https://my.spacefast.com/claim#sfc_1', key: 'sfc_1' },
		notes: [],
	} );
	await push( 'new' );
	expect( captureLocalSite ).toHaveBeenCalledWith(
		'http://localhost:8884',
		expect.any( String ),
		expect.any( Function )
	);
	expect( publish ).toHaveBeenLastCalledWith( {
		target: 'spacefast',
		token: undefined,
		space: undefined,
	} );
	expect( ( await spacefast.targets( site ) ).targets ).toEqual( [
		expect.objectContaining( {
			id: 'spc_1',
			url: 'https://indigo-hill.space.fast/',
			claim: 'https://my.spacefast.com/claim#sfc_1',
		} ),
	] );

	publish.mockResolvedValueOnce( { liveUrl: 'https://indigo-hill.space.fast/', notes: [] } );
	await push( 'spc_1' );
	expect( publish ).toHaveBeenLastCalledWith( {
		target: 'spacefast',
		token: 'sfc_1',
		space: 'spc_1',
	} );
	expect( ( await spacefast.targets( site ) ).targets[ 0 ] ).toMatchObject( {
		id: 'spc_1',
		claim: 'https://my.spacefast.com/claim#sfc_1',
	} );

	await expect( push( 'spc_other' ) ).rejects.toThrow( 'Publish it to "spc_1" instead.' );
	expect( publish ).toHaveBeenCalledTimes( 2 );

	publish.mockResolvedValueOnce( { liveUrl: 'https://teal-moon.space.fast/', notes: [] } );
	await push( 'new' );
	expect( publish ).toHaveBeenLastCalledWith( {
		target: 'spacefast',
		token: undefined,
		space: undefined,
	} );
} );

it( "publishes into the user's account with SPACEFAST_TOKEN", async () => {
	vi.stubEnv( 'SPACEFAST_TOKEN', 'sfa_user' );
	publish.mockResolvedValueOnce( { liveUrl: 'https://mine.space.fast/', notes: [] } );
	await push( 'new' );
	expect( publish ).toHaveBeenLastCalledWith( expect.objectContaining( { token: 'sfa_user' } ) );
} );
