import { vi } from 'vitest';
import { isEmptyDir, pathExists } from '@studio/common/lib/fs-utils';
import { generateNumberedName, generateSiteName } from '../generate-site-name';

vi.mock( '@studio/common/lib/fs-utils' );

const SITES_DIR = '/tmp/test-sites';

describe( 'generateSiteName', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( pathExists ).mockResolvedValue( false );
		vi.mocked( isEmptyDir ).mockResolvedValue( true );
	} );

	it( 'returns default name when no sites exist', async () => {
		const name = await generateSiteName( [], SITES_DIR );
		expect( name ).toBe( 'My WordPress Website' );
	} );

	it( 'returns a random alternative when default name is taken', async () => {
		const name = await generateSiteName( [ 'My WordPress Website' ], SITES_DIR );
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
		const name = await generateSiteName( allNames, SITES_DIR );
		expect( name ).toBe( 'My WordPress Website 2' );
	} );

	it( 'skips default name when its path already exists and is non-empty', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p ) => {
			return String( p ).includes( 'my-wordpress-website' );
		} );
		vi.mocked( isEmptyDir ).mockResolvedValue( false );
		const name = await generateSiteName( [], SITES_DIR );
		expect( name ).not.toBe( 'My WordPress Website' );
	} );
} );

describe( 'generateNumberedName', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( pathExists ).mockResolvedValue( false );
	} );

	it( 'returns the base name if available', async () => {
		const name = await generateNumberedName( 'My Site', [], SITES_DIR );
		expect( name ).toBe( 'My Site' );
	} );

	it( 'appends a number when base name is taken', async () => {
		const name = await generateNumberedName( 'My Site', [ 'My Site' ], SITES_DIR );
		expect( name ).toBe( 'My Site 2' );
	} );

	it( 'increments until an available name is found', async () => {
		const name = await generateNumberedName(
			'My Site',
			[ 'My Site', 'My Site 2', 'My Site 3' ],
			SITES_DIR
		);
		expect( name ).toBe( 'My Site 4' );
	} );
} );
