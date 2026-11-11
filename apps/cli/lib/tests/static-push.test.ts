import fs from 'fs';
import os from 'os';
import path from 'path';
import { readProviderConfig } from '@studio/common/lib/provider-config';
import { getRemoteSites, rememberRemoteSite } from '@studio/common/lib/remote-sites';
import { getProvider } from '@studio/providers/services';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runCommand as exportStaticSite } from 'cli/commands/export-static';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { pushStaticSite } from 'cli/lib/static-push';
import { Logger } from 'cli/logger';
import type { PushContent, Space } from '@studio/providers';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( '@studio/common/lib/provider-config' );
vi.mock( '@studio/common/lib/remote-sites' );
vi.mock( 'cli/commands/export-static' );
vi.mock( 'cli/lib/cli-config/sites' );
vi.mock( '@studio/providers/services', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@studio/providers/services') >();
	const sites = { list: vi.fn(), create: vi.fn(), push: vi.fn() };
	return {
		...actual,
		getProvider: ( id: string ) =>
			id === 'spacefast' ? { sites } : actual.getProvider( id as never ),
	};
} );

const space: Space = {
	id: 'spc_1',
	name: 'My Site',
	url: 'https://my-site.space.fast',
	slug: 'my-site',
	teamId: 'team_1',
};
const sites = getProvider( 'spacefast' ).sites!;
let sitePath: string;

beforeEach( () => {
	sitePath = fs.mkdtempSync( path.join( os.tmpdir(), 'static-push-' ) );
	fs.writeFileSync( path.join( sitePath, '_redirects' ), '/old /new 301' );
	vi.mocked( getSiteByFolder ).mockResolvedValue( {
		id: 'site-1',
		name: 'My Site',
		path: sitePath,
	} as SiteData );
	vi.mocked( readProviderConfig ).mockResolvedValue( { apiKey: 'sfa_key' } as never );
	vi.mocked( exportStaticSite ).mockImplementation( async ( _site, outputDir ) => {
		fs.writeFileSync( path.join( outputDir, 'index.html' ), 'home' );
	} );
} );

afterEach( () => {
	vi.resetAllMocks();
	fs.rmSync( sitePath, { recursive: true, force: true } );
} );

it( 'publishes the export and the root files to the Space the site last published to', async () => {
	vi.mocked( getRemoteSites ).mockResolvedValue( [
		{ ...space, lastPushTimestamp: '2026-11-01T00:00:00Z', lastPullTimestamp: null },
	] );
	const published: Record< string, string > = {};
	vi.mocked( sites.push ).mockImplementation( async ( _config, _site, content: PushContent ) => {
		if ( content.kind === 'files' ) {
			for ( const file of content.files ) {
				published[ file.path ] = new TextDecoder().decode( await file.read() );
			}
		}
	} );

	await expect( pushStaticSite( sitePath, undefined, new Logger() ) ).resolves.toMatchObject( {
		id: 'spc_1',
	} );

	expect( exportStaticSite ).toHaveBeenCalledWith(
		sitePath,
		expect.any( String ),
		space.url,
		true
	);
	expect( published ).toEqual( { 'index.html': 'home', _redirects: '/old /new 301' } );
	expect( rememberRemoteSite ).toHaveBeenCalledWith( 'spacefast', 'site-1', space, 'push' );
} );

it( 'asks for a Space when there is no terminal to pick one in', async () => {
	vi.mocked( getRemoteSites ).mockResolvedValue( [] );
	vi.mocked( sites.list ).mockResolvedValue( [ space ] );

	await expect( pushStaticSite( sitePath, undefined, new Logger() ) ).rejects.toThrow(
		'Choose a Space with `--remote-site spacefast:<space>`'
	);
	expect( sites.push ).not.toHaveBeenCalled();
} );
