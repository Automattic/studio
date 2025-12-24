import { getDomainNameValidationError } from 'common/lib/domains';
import { arePathsEqual } from 'common/lib/fs-utils';
import {
	SiteData,
	lockAppdata,
	readAppdata,
	saveAppdata,
	unlockAppdata,
	updateSiteLatestCliPid,
} from 'cli/lib/appdata';
import { updateDomainInHosts } from 'cli/lib/hosts-file';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { setupCustomDomain } from 'cli/lib/site-utils';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';

jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	lockAppdata: jest.fn(),
	readAppdata: jest.fn(),
	saveAppdata: jest.fn(),
	unlockAppdata: jest.fn(),
	updateSiteLatestCliPid: jest.fn(),
} ) );
jest.mock( 'cli/lib/pm2-manager' );
jest.mock( 'cli/lib/wordpress-server-manager' );
jest.mock( 'common/lib/fs-utils' );
jest.mock( 'cli/lib/hosts-file' );
jest.mock( 'cli/lib/site-utils' );
jest.mock( 'common/lib/domains' );

describe( 'CLI: studio site set-domain', () => {
	// Simple test data
	const testSitePath = '/test/site/path';
	const testDomainName = 'example.local';

	const createTestSite = (): SiteData => ( {
		id: 'site-1',
		name: 'Test Site',
		path: testSitePath,
		port: 8881,
		adminUsername: 'admin',
		adminPassword: 'password123',
		running: false,
		phpVersion: '8.0',
	} );

	const testProcessDescription = {
		pid: 12345,
		status: 'online',
	};

	let testSite: SiteData;

	beforeEach( () => {
		jest.clearAllMocks();

		testSite = createTestSite();

		( connect as jest.Mock ).mockResolvedValue( undefined );
		( disconnect as jest.Mock ).mockResolvedValue( undefined );
		( lockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( readAppdata as jest.Mock ).mockResolvedValue( {
			sites: [ testSite ],
			snapshots: [],
		} );
		( saveAppdata as jest.Mock ).mockResolvedValue( undefined );
		( unlockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( isServerRunning as jest.Mock ).mockResolvedValue( undefined );
		( startWordPressServer as jest.Mock ).mockResolvedValue( testProcessDescription );
		( stopWordPressServer as jest.Mock ).mockResolvedValue( undefined );
		( arePathsEqual as jest.Mock ).mockImplementation( ( a: string, b: string ) => a === b );
		( updateDomainInHosts as jest.Mock ).mockResolvedValue( undefined );
		( setupCustomDomain as jest.Mock ).mockResolvedValue( undefined );
		( getDomainNameValidationError as jest.Mock ).mockReturnValue( '' );
		( updateSiteLatestCliPid as jest.Mock ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'should throw when site not found', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [],
				snapshots: [],
			} );

			const { runCommand } = await import( '../set-domain' );

			await expect( runCommand( testSitePath, testDomainName ) ).rejects.toThrow(
				'The specified folder is not added to Studio.'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when domain is invalid', async () => {
			( getDomainNameValidationError as jest.Mock ).mockReturnValue(
				'Please enter a valid domain name'
			);

			const { runCommand } = await import( '../set-domain' );

			await expect( runCommand( testSitePath, 'invalid domain' ) ).rejects.toThrow();
			expect( saveAppdata ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when domain already in use by another site', async () => {
			( getDomainNameValidationError as jest.Mock ).mockReturnValue(
				'The domain name is already in use'
			);

			const { runCommand } = await import( '../set-domain' );

			await expect( runCommand( testSitePath, testDomainName ) ).rejects.toThrow();
			expect( saveAppdata ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when domain is identical to current domain', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ { ...testSite, customDomain: testDomainName } ],
				snapshots: [],
			} );

			const { runCommand } = await import( '../set-domain' );

			await expect( runCommand( testSitePath, testDomainName ) ).rejects.toThrow(
				'The specified domain is already set for this site.'
			);
			expect( saveAppdata ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when appdata save fails', async () => {
			( saveAppdata as jest.Mock ).mockRejectedValue( new Error( 'Save failed' ) );

			const { runCommand } = await import( '../set-domain' );

			await expect( runCommand( testSitePath, testDomainName ) ).rejects.toThrow();
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should set domain on a stopped site', async () => {
			const { runCommand } = await import( '../set-domain' );

			await runCommand( testSitePath, testDomainName );

			expect( lockAppdata ).toHaveBeenCalled();
			expect( readAppdata ).toHaveBeenCalled();
			expect( saveAppdata ).toHaveBeenCalled();
			expect( unlockAppdata ).toHaveBeenCalled();

			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].customDomain ).toBe( testDomainName );

			expect( isServerRunning ).toHaveBeenCalledWith( testSite.id );
			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( updateSiteLatestCliPid ).not.toHaveBeenCalled();
			expect( updateDomainInHosts ).toHaveBeenCalledWith(
				undefined,
				testDomainName,
				testSite.port
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should set domain and restart a running site', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );

			const { runCommand } = await import( '../set-domain' );

			await runCommand( testSitePath, testDomainName );

			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].customDomain ).toBe( testDomainName );

			expect( isServerRunning ).toHaveBeenCalledWith( testSite.id );
			expect( stopWordPressServer ).toHaveBeenCalledWith( testSite.id );
			expect( setupCustomDomain ).toHaveBeenCalledWith( testSite, expect.any( Logger ), {
				skipHostsUpdate: true,
			} );
			expect( startWordPressServer ).toHaveBeenCalledWith( testSite, expect.any( Logger ) );
			expect( updateSiteLatestCliPid ).toHaveBeenCalledWith(
				testSite.id,
				testProcessDescription.pid
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should update hosts file with old and new domain when replacing domain', async () => {
			const oldDomain = 'old.local';
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ { ...testSite, customDomain: oldDomain } ],
				snapshots: [],
			} );

			const { runCommand } = await import( '../set-domain' );

			await runCommand( testSitePath, testDomainName );

			expect( updateDomainInHosts ).toHaveBeenCalledWith(
				oldDomain,
				testDomainName,
				testSite.port
			);
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );
} );
