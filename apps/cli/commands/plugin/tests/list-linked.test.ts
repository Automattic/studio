import fs from 'fs';
import path from 'path';
import { pathExists } from '@studio/common/lib/fs-utils';
import { vi } from 'vitest';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { runCommand } from '../list-linked';

vi.mock( 'fs', () => {
	const promises = {
		lstat: vi.fn(),
		readlink: vi.fn(),
		readdir: vi.fn(),
	};
	return { default: { promises }, promises };
} );
vi.mock( '@studio/common/lib/fs-utils', () => ( {
	pathExists: vi.fn(),
} ) );
vi.mock( 'cli/lib/cli-config/sites', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config/sites' );
	return {
		...( actual as object ),
		getSiteByFolder: vi.fn(),
	};
} );

describe( 'CLI: studio plugin list-linked', () => {
	const testSiteFolder = '/test/site/path';
	const pluginsDir = path.join( testSiteFolder, 'wp-content', 'plugins' );

	const makeDirent = ( name: string ): fs.Dirent =>
		( {
			name,
			isSymbolicLink: () => true,
			isDirectory: () => false,
			isFile: () => false,
		} ) as unknown as fs.Dirent;

	let consoleLogSpy: ReturnType< typeof vi.spyOn >;

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( getSiteByFolder ).mockResolvedValue( {
			id: 'test-site-id',
			name: 'Test Site',
			path: testSiteFolder,
			port: 8881,
			phpVersion: '8.0',
		} );

		vi.mocked( pathExists ).mockResolvedValue( true );
		consoleLogSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	const joinedOutput = () =>
		consoleLogSpy.mock.calls.map( ( c: unknown[] ) => String( c[ 0 ] ?? '' ) ).join( '\n' );

	it( 'prints no linked plugins message when plugins dir is missing', async () => {
		vi.mocked( pathExists ).mockResolvedValue( false );

		await runCommand( testSiteFolder, 'table' );

		expect( joinedOutput() ).toMatch( /No linked plugins found/ );
	} );

	it( 'prints no linked plugins message when dir has no symlinks', async () => {
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			{ name: 'regular-plugin', isSymbolicLink: () => false },
		] as unknown as never );
		vi.mocked( fs.promises.lstat ).mockResolvedValue( {
			isSymbolicLink: () => false,
		} as fs.Stats );

		await runCommand( testSiteFolder, 'table' );

		expect( joinedOutput() ).toMatch( /No linked plugins found/ );
	} );

	it( 'lists linked plugins in table format', async () => {
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			makeDirent( 'plugin-a' ),
			makeDirent( 'plugin-b' ),
		] as unknown as never );
		vi.mocked( fs.promises.lstat ).mockResolvedValue( {
			isSymbolicLink: () => true,
		} as fs.Stats );
		vi.mocked( fs.promises.readlink ).mockImplementation( async ( p ) => {
			const name = path.basename( String( p ) );
			return path.relative( pluginsDir, `/dev/${ name }` );
		} );

		await runCommand( testSiteFolder, 'table' );

		const output = joinedOutput();
		expect( output ).toMatch( /Found 2 linked plugin/ );
		expect( output ).toContain( 'plugin-a' );
		expect( output ).toContain( 'plugin-b' );
		expect( output ).toContain( '/dev/plugin-a' );
		expect( output ).toContain( '/dev/plugin-b' );
	} );

	it( 'outputs JSON format', async () => {
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			makeDirent( 'plugin-a' ),
		] as unknown as never );
		vi.mocked( fs.promises.lstat ).mockResolvedValue( {
			isSymbolicLink: () => true,
		} as fs.Stats );
		vi.mocked( fs.promises.readlink ).mockResolvedValue(
			path.relative( pluginsDir, '/dev/plugin-a' )
		);

		await runCommand( testSiteFolder, 'json' );

		expect( consoleLogSpy ).toHaveBeenCalledTimes( 1 );
		const parsed = JSON.parse( consoleLogSpy.mock.calls[ 0 ][ 0 ] as string );
		expect( parsed ).toEqual( [ { name: 'plugin-a', sourcePath: '/dev/plugin-a' } ] );
	} );

	it( 'skips entries that fail to stat', async () => {
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			makeDirent( 'broken' ),
			makeDirent( 'good' ),
		] as unknown as never );
		vi.mocked( fs.promises.lstat ).mockImplementation( async ( p ) => {
			if ( String( p ).endsWith( 'broken' ) ) {
				throw new Error( 'EACCES' );
			}
			return { isSymbolicLink: () => true } as fs.Stats;
		} );
		vi.mocked( fs.promises.readlink ).mockResolvedValue( path.relative( pluginsDir, '/dev/good' ) );

		await runCommand( testSiteFolder, 'json' );

		const parsed = JSON.parse( consoleLogSpy.mock.calls[ 0 ][ 0 ] as string );
		expect( parsed ).toEqual( [ { name: 'good', sourcePath: '/dev/good' } ] );
	} );
} );
