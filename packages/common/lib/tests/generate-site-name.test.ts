import { vi } from 'vitest';
import { isEmptyDir, pathExists } from '@studio/common/lib/fs-utils';
import { generateNumberedName, generateSiteName } from '../generate-site-name';

vi.mock( '@studio/common/lib/fs-utils' );

const SITES_DIR = '/tmp/test-sites';
const SITE_NAMES = [
	'Blue Note',
	'Kind of Blue',
	'Hello Dolly',
	'Round Midnight',
	'Blue in Green',
	'Take Five',
	'Giant Steps',
	'Mood Indigo',
	'Swing Time',
	'Blue Train',
	'Maiden Voyage',
	'Birdland',
	'Green Dolphin Street',
	'Cotton Tail',
];

afterEach( () => vi.restoreAllMocks() );

describe( 'generateSiteName', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( pathExists ).mockResolvedValue( false );
		vi.mocked( isEmptyDir ).mockResolvedValue( true );
		vi.spyOn( Math, 'random' ).mockReturnValue( 0 );
	} );

	it( 'suggests a jazz name when no sites exist', async () => {
		const name = await generateSiteName( [], SITES_DIR );
		expect( name ).toBe( 'Blue Note' );
	} );

	it( 'randomizes the suggestion even when no sites exist', async () => {
		vi.mocked( Math.random ).mockReturnValue( 0.99 );
		expect( await generateSiteName( [], SITES_DIR ) ).toBe( 'Cotton Tail' );
	} );

	it( 'excludes names already used by a site', async () => {
		const name = await generateSiteName( [ 'Blue Note' ], SITES_DIR );
		expect( name ).toBe( 'Kind of Blue' );
	} );

	it( 'returns numbered name when all names are taken', async () => {
		const name = await generateSiteName( [ ...SITE_NAMES, 'Blue Note 2' ], SITES_DIR );
		expect( name ).toBe( 'Blue Note 3' );
	} );

	it( 'skips a name when its path already exists and is non-empty', async () => {
		vi.mocked( pathExists ).mockImplementation( async ( p ) => {
			return String( p ).includes( 'blue-note' );
		} );
		vi.mocked( isEmptyDir ).mockResolvedValue( false );
		const name = await generateSiteName( [], SITES_DIR );
		expect( name ).toBe( 'Kind of Blue' );
	} );

	it( 'allows an existing empty folder', async () => {
		vi.mocked( pathExists ).mockResolvedValue( true );
		expect( await generateSiteName( [], SITES_DIR ) ).toBe( 'Blue Note' );
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
