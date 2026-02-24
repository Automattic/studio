import { confirm, input, select } from '@inquirer/prompts';
import {
	pathExists,
	isEmptyDir,
	isWordPressDirectory,
	arePathsEqual,
} from '@studio/common/lib/fs-utils';
import { portFinder } from '@studio/common/lib/port-finder';
import { fetchWordPressVersions } from '@studio/common/lib/wordpress-versions';
import { vi } from 'vitest';
import yargs from 'yargs';
import { readAppdata, lockAppdata, unlockAppdata, saveAppdata } from 'cli/lib/appdata';
import { generateSiteName, getDefaultSitePath } from 'cli/lib/generate-site-name';
import { isInteractive } from 'cli/lib/is-interactive';
import { getPreferredSiteLanguage } from 'cli/lib/site-language';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { startWordPressServer } from 'cli/lib/wordpress-server-manager';
import {
	mockReportStart,
	mockReportSuccess,
	mockReportError,
	mockReportProgress,
	mockReportWarning,
	mockReportKeyValuePair,
} from 'cli/tests/test-utils';
import { registerCommand } from '../create';

vi.mock( '@inquirer/prompts' );
vi.mock( 'cli/lib/is-interactive' );
vi.mock( 'cli/lib/generate-site-name' );
vi.mock( '@studio/common/lib/wordpress-versions' );
vi.mock( '@studio/common/lib/fs-utils' );
vi.mock( '@studio/common/lib/network-utils' );
vi.mock( '@studio/common/lib/port-finder', () => ( {
	portFinder: { addUnavailablePort: vi.fn(), getOpenPort: vi.fn() },
} ) );
vi.mock( '@studio/common/lib/passwords', () => ( {
	createPassword: vi.fn().mockReturnValue( 'test-password' ),
} ) );
vi.mock( 'cli/lib/appdata', async () => {
	const actual = await vi.importActual( 'cli/lib/appdata' );
	return {
		...actual,
		getAppdataDirectory: vi.fn().mockReturnValue( '/test/appdata' ),
		readAppdata: vi.fn(),
		saveAppdata: vi.fn(),
		lockAppdata: vi.fn(),
		unlockAppdata: vi.fn(),
		updateSiteLatestCliPid: vi.fn(),
		updateSiteAutoStart: vi.fn(),
		removeSiteFromAppdata: vi.fn(),
		getSiteUrl: vi
			.fn()
			.mockImplementation( ( site: { port: number } ) => `http://localhost:${ site.port }` ),
	};
} );
vi.mock( 'cli/lib/pm2-manager' );
vi.mock( 'cli/lib/server-files', () => ( {
	getServerFilesPath: vi.fn().mockReturnValue( '/test/server-files' ),
} ) );
vi.mock( 'cli/lib/site-language' );
vi.mock( 'cli/lib/site-utils' );
vi.mock( 'cli/lib/sqlite-integration' );
vi.mock( 'cli/lib/wordpress-server-manager' );
vi.mock( 'cli/lib/language-packs' );
vi.mock( '@studio/common/lib/blueprint-validation' );
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

function createParser() {
	const parser = yargs()
		.option( 'path', {
			type: 'string',
			normalize: true,
			default: process.cwd(),
			coerce: ( value: string ) => require( 'path' ).resolve( value ),
		} )
		.command( 'site', 'Manage sites', ( siteYargs ) => {
			registerCommand( siteYargs as ReturnType< typeof yargs > );
		} );
	return parser;
}

describe( 'site create: interactive mode', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( isInteractive ).mockReturnValue( true );
		vi.mocked( generateSiteName ).mockResolvedValue( 'My WordPress Website' );
		vi.mocked( getDefaultSitePath ).mockReturnValue( '/home/user/Studio/my-wordpress-website' );
		vi.mocked( input ).mockResolvedValue( '' );
		vi.mocked( select ).mockResolvedValue( 'latest' );
		vi.mocked( confirm ).mockResolvedValue( false );
		vi.mocked( fetchWordPressVersions ).mockResolvedValue( [
			{ label: 'latest (6.7)', value: 'latest', isBeta: false, isDevelopment: false },
			{ label: 'nightly', value: 'nightly', isBeta: false, isDevelopment: true },
			{ label: '6.7', value: '6.7', isBeta: false, isDevelopment: false },
			{ label: '6.6', value: '6.6.2', isBeta: false, isDevelopment: false },
		] );

		// Mock runCommand dependencies so it doesn't crash
		vi.mocked( pathExists ).mockResolvedValue( false );
		vi.mocked( isEmptyDir ).mockResolvedValue( true );
		vi.mocked( isWordPressDirectory ).mockReturnValue( false );
		vi.mocked( arePathsEqual ).mockImplementation( ( a, b ) => a === b );
		vi.mocked( portFinder.getOpenPort ).mockResolvedValue( 8881 );
		vi.mocked( readAppdata, { partial: true } ).mockResolvedValue( {
			sites: [],
			snapshots: [],
		} );
		vi.mocked( saveAppdata ).mockResolvedValue( undefined );
		vi.mocked( lockAppdata ).mockResolvedValue( undefined );
		vi.mocked( unlockAppdata ).mockResolvedValue( undefined );
		vi.mocked( keepSqliteIntegrationUpdated ).mockResolvedValue( true );
		vi.mocked( startWordPressServer ).mockResolvedValue( {
			name: 'test-id',
			pmId: 0,
			status: 'online',
			pid: 12345,
		} );
		vi.mocked( getPreferredSiteLanguage ).mockResolvedValue( 'en' );
	} );

	it( 'prompts for site name when not provided', async () => {
		vi.mocked( input )
			.mockResolvedValueOnce( 'My Test Site' )
			.mockResolvedValueOnce( '/home/user/Studio/my-test-site' )
			.mockResolvedValueOnce( '' );
		vi.mocked( select ).mockResolvedValueOnce( 'latest' ).mockResolvedValueOnce( '8.3' );

		await createParser().parseAsync( [ 'site', 'create' ] );

		expect( input ).toHaveBeenCalledWith( expect.objectContaining( { message: 'Site name:' } ) );
	} );

	it( 'skips name prompt when --name is provided', async () => {
		vi.mocked( input )
			.mockResolvedValueOnce( '/home/user/Studio/test' )
			.mockResolvedValueOnce( '' );
		vi.mocked( select ).mockResolvedValueOnce( 'latest' ).mockResolvedValueOnce( '8.3' );

		await createParser().parseAsync( [ 'site', 'create', '--name', 'Explicit Name' ] );

		expect( input ).not.toHaveBeenCalledWith(
			expect.objectContaining( { message: 'Site name:' } )
		);
	} );

	it( 'prompts for site path when not provided', async () => {
		vi.mocked( input )
			.mockResolvedValueOnce( 'My Test Site' )
			.mockResolvedValueOnce( '/home/user/Studio/my-test-site' )
			.mockResolvedValueOnce( '' );
		vi.mocked( select ).mockResolvedValueOnce( 'latest' ).mockResolvedValueOnce( '8.3' );

		await createParser().parseAsync( [ 'site', 'create' ] );

		expect( input ).toHaveBeenCalledWith( expect.objectContaining( { message: 'Site path:' } ) );
	} );

	it( 'skips path prompt when --path is provided', async () => {
		vi.mocked( input ).mockResolvedValueOnce( 'My Test Site' ).mockResolvedValueOnce( '' );
		vi.mocked( select ).mockResolvedValueOnce( 'latest' ).mockResolvedValueOnce( '8.3' );

		await createParser().parseAsync( [ 'site', 'create', '--path', '/custom/path' ] );

		expect( input ).not.toHaveBeenCalledWith(
			expect.objectContaining( { message: 'Site path:' } )
		);
	} );

	it( 'prompts for WP version when not provided', async () => {
		vi.mocked( input )
			.mockResolvedValueOnce( 'My Test Site' )
			.mockResolvedValueOnce( '/home/user/Studio/my-test-site' )
			.mockResolvedValueOnce( '' );
		vi.mocked( select ).mockResolvedValueOnce( 'latest' ).mockResolvedValueOnce( '8.3' );

		await createParser().parseAsync( [ 'site', 'create' ] );

		expect( select ).toHaveBeenCalledWith(
			expect.objectContaining( { message: 'WordPress version:' } )
		);
	} );

	it( 'skips WP version prompt when --wp is provided', async () => {
		vi.mocked( input )
			.mockResolvedValueOnce( 'My Test Site' )
			.mockResolvedValueOnce( '/home/user/Studio/my-test-site' )
			.mockResolvedValueOnce( '' );
		vi.mocked( select ).mockResolvedValueOnce( '8.3' );

		await createParser().parseAsync( [ 'site', 'create', '--wp', '6.7' ] );

		expect( select ).not.toHaveBeenCalledWith(
			expect.objectContaining( { message: 'WordPress version:' } )
		);
	} );

	it( 'prompts for PHP version when not provided', async () => {
		vi.mocked( input )
			.mockResolvedValueOnce( 'My Test Site' )
			.mockResolvedValueOnce( '/home/user/Studio/my-test-site' )
			.mockResolvedValueOnce( '' );
		vi.mocked( select ).mockResolvedValueOnce( 'latest' ).mockResolvedValueOnce( '8.3' );

		await createParser().parseAsync( [ 'site', 'create' ] );

		expect( select ).toHaveBeenCalledWith( expect.objectContaining( { message: 'PHP version:' } ) );
	} );

	it( 'skips PHP version prompt when --php is provided', async () => {
		vi.mocked( input )
			.mockResolvedValueOnce( 'My Test Site' )
			.mockResolvedValueOnce( '/home/user/Studio/my-test-site' )
			.mockResolvedValueOnce( '' );
		vi.mocked( select ).mockResolvedValueOnce( 'latest' );

		await createParser().parseAsync( [ 'site', 'create', '--php', '8.0' ] );

		expect( select ).not.toHaveBeenCalledWith(
			expect.objectContaining( { message: 'PHP version:' } )
		);
	} );

	it( 'prompts for custom domain', async () => {
		vi.mocked( input )
			.mockResolvedValueOnce( 'My Test Site' )
			.mockResolvedValueOnce( '/home/user/Studio/my-test-site' )
			.mockResolvedValueOnce( '' );
		vi.mocked( select ).mockResolvedValueOnce( 'latest' ).mockResolvedValueOnce( '8.3' );

		await createParser().parseAsync( [ 'site', 'create' ] );

		expect( input ).toHaveBeenCalledWith(
			expect.objectContaining( { message: 'Custom domain (leave empty to skip):' } )
		);
	} );

	it( 'skips domain prompt when --domain is provided', async () => {
		vi.mocked( input )
			.mockResolvedValueOnce( 'My Test Site' )
			.mockResolvedValueOnce( '/home/user/Studio/my-test-site' );
		vi.mocked( select ).mockResolvedValueOnce( 'latest' ).mockResolvedValueOnce( '8.3' );

		await createParser().parseAsync( [ 'site', 'create', '--domain', 'mysite.local' ] );

		expect( input ).not.toHaveBeenCalledWith(
			expect.objectContaining( { message: 'Custom domain (leave empty to skip):' } )
		);
	} );

	it( 'prompts for HTTPS when custom domain is entered', async () => {
		vi.mocked( input )
			.mockResolvedValueOnce( 'My Test Site' )
			.mockResolvedValueOnce( '/home/user/Studio/my-test-site' )
			.mockResolvedValueOnce( 'mysite.local' );
		vi.mocked( select ).mockResolvedValueOnce( 'latest' ).mockResolvedValueOnce( '8.3' );
		vi.mocked( confirm ).mockResolvedValueOnce( true );

		await createParser().parseAsync( [ 'site', 'create' ] );

		expect( confirm ).toHaveBeenCalledWith(
			expect.objectContaining( { message: 'Enable HTTPS?' } )
		);
	} );

	it( 'does not prompt for HTTPS when no custom domain is entered', async () => {
		vi.mocked( input )
			.mockResolvedValueOnce( 'My Test Site' )
			.mockResolvedValueOnce( '/home/user/Studio/my-test-site' )
			.mockResolvedValueOnce( '' );
		vi.mocked( select ).mockResolvedValueOnce( 'latest' ).mockResolvedValueOnce( '8.3' );

		await createParser().parseAsync( [ 'site', 'create' ] );

		expect( confirm ).not.toHaveBeenCalled();
	} );

	it( 'exits gracefully when user cancels prompt', async () => {
		vi.mocked( input ).mockRejectedValueOnce( new Error( 'User cancelled' ) );

		await createParser().parseAsync( [ 'site', 'create' ] );

		// Should not throw - handler catches the error and returns
		expect( lockAppdata ).not.toHaveBeenCalled();
	} );
} );

describe( 'site create: non-interactive mode', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( isInteractive ).mockReturnValue( false );

		// Mock runCommand dependencies
		vi.mocked( pathExists ).mockResolvedValue( false );
		vi.mocked( isEmptyDir ).mockResolvedValue( true );
		vi.mocked( isWordPressDirectory ).mockReturnValue( false );
		vi.mocked( arePathsEqual ).mockImplementation( ( a, b ) => a === b );
		vi.mocked( portFinder.getOpenPort ).mockResolvedValue( 8881 );
		vi.mocked( readAppdata, { partial: true } ).mockResolvedValue( {
			sites: [],
			snapshots: [],
		} );
		vi.mocked( saveAppdata ).mockResolvedValue( undefined );
		vi.mocked( lockAppdata ).mockResolvedValue( undefined );
		vi.mocked( unlockAppdata ).mockResolvedValue( undefined );
		vi.mocked( keepSqliteIntegrationUpdated ).mockResolvedValue( true );
		vi.mocked( startWordPressServer ).mockResolvedValue( {
			name: 'test-id',
			pmId: 0,
			status: 'online',
			pid: 12345,
		} );
		vi.mocked( getPreferredSiteLanguage ).mockResolvedValue( 'en' );
	} );

	it( 'does not show any prompts', async () => {
		await createParser().parseAsync( [ 'site', 'create' ] );

		expect( input ).not.toHaveBeenCalled();
		expect( select ).not.toHaveBeenCalled();
		expect( confirm ).not.toHaveBeenCalled();
	} );
} );
