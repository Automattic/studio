import { generateCheckoutUrl } from '@studio/common/lib/generate-checkout-url';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { getAppConfigPath } from '@studio/common/lib/well-known-paths';
import { readFile } from 'atomically';
import { vi } from 'vitest';
import { openBrowser } from 'cli/lib/browser';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { LoggerError } from 'cli/logger';
import {
	mockReportError,
	mockReportKeyValuePair,
	mockReportProgress,
	mockReportStart,
	mockReportSuccess,
	mockReportWarning,
} from 'cli/tests/test-utils';
import { runCommand } from '../publish';

vi.mock( '@studio/common/lib/generate-checkout-url' );
vi.mock( '@studio/common/lib/shared-config', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/shared-config') >() ),
	readAuthToken: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/well-known-paths' );
vi.mock( 'atomically' );
vi.mock( 'cli/lib/browser', () => ( {
	openBrowser: vi.fn(),
} ) );

vi.mock( 'cli/lib/cli-config/sites', () => ( {
	getSiteByFolder: vi.fn(),
} ) );

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

describe( 'Publish Command', () => {
	const siteFolder = '/Users/test/Studio/my-site';
	const checkoutUrl = 'https://wordpress.com/checkout/123';
	const mockToken = {
		accessToken: 'token',
		id: 42,
		email: 'test@example.com',
		displayName: 'Test',
		expiresIn: 1209600,
		expirationTime: Date.now() + 1209600000,
	};
	const mockSite = {
		id: 'site-abc',
		name: 'my-site',
		path: siteFolder,
	};

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( readAuthToken ).mockResolvedValue( mockToken );
		vi.mocked( getSiteByFolder ).mockResolvedValue( mockSite as never );
		vi.mocked( getAppConfigPath ).mockReturnValue( '/tmp/appdata-v1.json' );
		vi.mocked( generateCheckoutUrl ).mockReturnValue( checkoutUrl );
		vi.mocked( openBrowser ).mockResolvedValue( undefined );
		vi.mocked( readFile ).mockRejectedValue( new Error( 'ENOENT' ) );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'reports error and skips browser when not authenticated', async () => {
		vi.mocked( readAuthToken ).mockResolvedValue( null );

		await runCommand( siteFolder );

		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( openBrowser ).not.toHaveBeenCalled();
		expect( getSiteByFolder ).not.toHaveBeenCalled();
	} );

	it( 'reports loading progress and success on happy path', async () => {
		await runCommand( siteFolder );

		expect( mockReportStart ).toHaveBeenCalledWith( 'loadSites', expect.any( String ) );
		expect( mockReportSuccess ).toHaveBeenCalledWith( 'Site loaded' );
	} );

	it( 'reports error and skips browser if site already connected', async () => {
		vi.mocked( readFile as ( ...args: unknown[] ) => Promise< string > ).mockResolvedValue(
			JSON.stringify( {
				connectedWpcomSites: {
					[ mockToken.id ]: [ { localSiteId: mockSite.id, id: 99 } ],
				},
			} )
		);

		await runCommand( siteFolder );

		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( openBrowser ).not.toHaveBeenCalled();
	} );

	it( 'proceeds when appdata file is missing', async () => {
		vi.mocked( readFile ).mockRejectedValue( new Error( 'ENOENT' ) );

		await runCommand( siteFolder );

		expect( openBrowser ).toHaveBeenCalledWith( checkoutUrl );
	} );

	it( 'proceeds when appdata contains invalid JSON', async () => {
		vi.mocked( readFile as ( ...args: unknown[] ) => Promise< string > ).mockResolvedValue(
			'not-json{'
		);

		await runCommand( siteFolder );

		expect( openBrowser ).toHaveBeenCalledWith( checkoutUrl );
	} );

	it( 'proceeds when user has no connected sites entry', async () => {
		vi.mocked( readFile as ( ...args: unknown[] ) => Promise< string > ).mockResolvedValue(
			JSON.stringify( { connectedWpcomSites: { 999: [] } } )
		);

		await runCommand( siteFolder );

		expect( openBrowser ).toHaveBeenCalledWith( checkoutUrl );
	} );

	it( 'opens the checkout URL and reports the follow-up message', async () => {
		await runCommand( siteFolder );

		expect( generateCheckoutUrl ).toHaveBeenCalledWith( mockSite, 'studio-publish', {
			autoOpenPush: true,
		} );
		expect( openBrowser ).toHaveBeenCalledWith( checkoutUrl );
		expect( mockReportSuccess ).toHaveBeenCalledWith(
			expect.stringContaining( 'Follow the procedure' )
		);
	} );

	it( 'reports error when openBrowser rejects', async () => {
		vi.mocked( openBrowser ).mockRejectedValue( new Error( 'no browser' ) );

		await runCommand( siteFolder );

		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );

	it( 'wraps unknown errors from getSiteByFolder', async () => {
		vi.mocked( getSiteByFolder ).mockRejectedValue( new Error( 'boom' ) );

		await runCommand( siteFolder );

		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( openBrowser ).not.toHaveBeenCalled();
	} );
} );
