import os from 'os';
import path from 'path';
import { isEmptyDir, pathExists } from '@studio/common/lib/fs-utils';
import { vi } from 'vitest';
import { readAppdata } from 'cli/lib/appdata';
import { generateSiteName, getDefaultSitePath } from 'cli/lib/generate-site-name';

vi.mock( '@studio/common/lib/fs-utils' );
vi.mock( 'cli/lib/appdata' );

describe( 'getDefaultSitePath', () => {
	it( 'returns path under ~/Studio with sanitized folder name', () => {
		const result = getDefaultSitePath( 'My WordPress Website' );
		expect( result ).toBe( path.join( os.homedir(), 'Studio', 'my-wordpress-website' ) );
	} );

	it( 'sanitizes special characters from name', () => {
		const result = getDefaultSitePath( 'My Site (Test)' );
		expect( result ).toBe( path.join( os.homedir(), 'Studio', 'my-site-test' ) );
	} );
} );

describe( 'generateSiteName', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( pathExists ).mockResolvedValue( false );
		vi.mocked( isEmptyDir ).mockResolvedValue( true );
	} );

	it( 'returns default name when no sites exist', async () => {
		vi.mocked( readAppdata, { partial: true } ).mockResolvedValue( { sites: [] } );
		const name = await generateSiteName();
		expect( name ).toBe( 'My WordPress Website' );
	} );

	it( 'returns a random alternative when default name is taken', async () => {
		vi.mocked( readAppdata, { partial: true } ).mockResolvedValue( {
			sites: [ { name: 'My WordPress Website' } ],
		} );
		const name = await generateSiteName();
		expect( name ).not.toBe( 'My WordPress Website' );
		expect( name ).toMatch( /^My \w+ Website$/ );
	} );

	it( 'returns numbered name when all names are taken', async () => {
		const allNames = [
			'My WordPress Website',
			'My Bold Website',
			'My Bright Website',
			'My Blissful Website',
			'My Calm Website',
			'My Cool Website',
			'My Dreamy Website',
			'My Elite Website',
			'My Fresh Website',
			'My Glowing Website',
			'My Happy Website',
			'My Joyful Website',
			'My Noble Website',
			'My Pure Website',
			'My Peak Website',
			'My Prime Website',
			'My Serene Website',
			'My Shiny Website',
			'My Sparkly Website',
			'My Swift Website',
			'My True Website',
		];
		vi.mocked( readAppdata, { partial: true } ).mockResolvedValue( {
			sites: allNames.map( ( name ) => ( { name } ) ),
		} );
		const name = await generateSiteName();
		expect( name ).toBe( 'My WordPress Website 2' );
	} );

	it( 'skips default name when its path already exists', async () => {
		vi.mocked( readAppdata, { partial: true } ).mockResolvedValue( { sites: [] } );
		vi.mocked( pathExists ).mockImplementation( async ( p ) => {
			return String( p ).includes( 'my-wordpress-website' );
		} );
		vi.mocked( isEmptyDir ).mockResolvedValue( false );
		const name = await generateSiteName();
		expect( name ).not.toBe( 'My WordPress Website' );
	} );
} );
