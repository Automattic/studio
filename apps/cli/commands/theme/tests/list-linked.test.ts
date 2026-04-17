import fs from 'fs';
import path from 'path';
import { pathExists } from '@studio/common/lib/fs-utils';
import { vi } from 'vitest';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import {
	mockReportStart,
	mockReportSuccess,
	mockReportError,
	mockReportProgress,
	mockReportWarning,
	mockReportKeyValuePair,
} from 'cli/tests/test-utils';
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
vi.mock( 'cli/logger', () => ( {
	Logger: class {
		reportStart = mockReportStart;
		reportSuccess = mockReportSuccess;
		reportError = mockReportError;
		reportProgress = mockReportProgress;
		reportWarning = mockReportWarning;
		reportKeyValuePair = mockReportKeyValuePair;
		spinner = {};
		currentAction = null;
	},
	LoggerError: class LoggerError extends Error {},
} ) );

describe( 'CLI: studio theme list-linked', () => {
	const testSiteFolder = '/test/site/path';
	const themesDir = path.join( testSiteFolder, 'wp-content', 'themes' );

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

	const loggerMessages = () =>
		[ ...mockReportStart.mock.calls, ...mockReportSuccess.mock.calls ]
			.map( ( c ) => String( c[ c.length - 1 ] ?? '' ) )
			.join( '\n' );

	it( 'prints no linked themes message when themes dir is missing', async () => {
		vi.mocked( pathExists ).mockResolvedValue( false );

		await runCommand( testSiteFolder, 'table' );

		expect( loggerMessages() ).toMatch( /No linked themes found/ );
	} );

	it( 'lists linked themes in table format', async () => {
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			makeDirent( 'theme-a' ),
			makeDirent( 'theme-b' ),
		] as unknown as never );
		vi.mocked( fs.promises.lstat ).mockResolvedValue( {
			isSymbolicLink: () => true,
		} as fs.Stats );
		vi.mocked( fs.promises.readlink ).mockImplementation( async ( p ) => {
			const name = path.basename( String( p ) );
			return path.relative( themesDir, `/dev/${ name }` );
		} );

		await runCommand( testSiteFolder, 'table' );

		expect( loggerMessages() ).toMatch( /Found 2 linked theme/ );
		const output = joinedOutput();
		expect( output ).toContain( 'theme-a' );
		expect( output ).toContain( 'theme-b' );
		expect( output ).toContain( '/dev/theme-a' );
		expect( output ).toContain( '/dev/theme-b' );
	} );

	it( 'outputs JSON format', async () => {
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [
			makeDirent( 'theme-a' ),
		] as unknown as never );
		vi.mocked( fs.promises.lstat ).mockResolvedValue( {
			isSymbolicLink: () => true,
		} as fs.Stats );
		vi.mocked( fs.promises.readlink ).mockResolvedValue(
			path.relative( themesDir, '/dev/theme-a' )
		);

		await runCommand( testSiteFolder, 'json' );

		expect( consoleLogSpy ).toHaveBeenCalledTimes( 1 );
		const parsed = JSON.parse( consoleLogSpy.mock.calls[ 0 ][ 0 ] as string );
		expect( parsed ).toEqual( [ { name: 'theme-a', sourcePath: '/dev/theme-a' } ] );
	} );
} );
