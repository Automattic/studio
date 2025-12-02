import { arePathsEqual } from 'common/lib/fs-utils';
import { SiteData, lockAppdata, readAppdata, saveAppdata, unlockAppdata } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';

jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	lockAppdata: jest.fn(),
	readAppdata: jest.fn(),
	saveAppdata: jest.fn(),
	unlockAppdata: jest.fn(),
} ) );
jest.mock( 'cli/lib/pm2-manager' );
jest.mock( 'cli/lib/wordpress-server-manager' );
jest.mock( 'common/lib/fs-utils' );

describe( 'CLI: studio site set-https', () => {
	const mockSiteFolder = '/test/site/path';

	const createMockSiteData = (): SiteData => ( {
		id: 'test-site-id',
		name: 'Test Site',
		path: mockSiteFolder,
		port: 8881,
		adminUsername: 'admin',
		adminPassword: 'password123',
		running: false,
		phpVersion: '8.0',
		url: `http://localhost:8881`,
		enableHttps: false,
		customDomain: 'test.local',
	} );

	const mockProcessDescription = {
		name: 'test-site-id',
		pmId: 0,
		status: 'online',
		pid: 12345,
	};

	let mockSiteData: SiteData;

	beforeEach( () => {
		jest.clearAllMocks();

		mockSiteData = createMockSiteData();

		( connect as jest.Mock ).mockResolvedValue( undefined );
		( disconnect as jest.Mock ).mockReturnValue( undefined );
		( lockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( readAppdata as jest.Mock ).mockResolvedValue( {
			sites: [ mockSiteData ],
			snapshots: [],
		} );
		( saveAppdata as jest.Mock ).mockResolvedValue( undefined );
		( unlockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( isServerRunning as jest.Mock ).mockResolvedValue( undefined );
		( startWordPressServer as jest.Mock ).mockResolvedValue( mockProcessDescription );
		( stopWordPressServer as jest.Mock ).mockResolvedValue( undefined );
		( arePathsEqual as jest.Mock ).mockImplementation( ( a: string, b: string ) => a === b );
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

			const { runCommand } = await import( '../set-https' );

			await expect( runCommand( mockSiteFolder, true ) ).rejects.toThrow(
				'The specified folder is not added to Studio.'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when site does not have a custom domain', async () => {
			const siteWithoutDomain = { ...mockSiteData, customDomain: undefined };
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ siteWithoutDomain ],
				snapshots: [],
			} );

			const { runCommand } = await import( '../set-https' );

			await expect( runCommand( mockSiteFolder, true ) ).rejects.toThrow(
				'Site does not have a custom domain.'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw if passing the same config value that the site already has', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ { ...mockSiteData, enableHttps: true } ],
				snapshots: [],
			} );

			const { runCommand } = await import( '../set-https' );

			await expect( runCommand( mockSiteFolder, true ) ).rejects.toThrow(
				'HTTPS is already enabled for this site.'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when appdata save fails', async () => {
			( saveAppdata as jest.Mock ).mockRejectedValue( new Error( 'Save failed' ) );

			const { runCommand } = await import( '../set-https' );

			await expect( runCommand( mockSiteFolder, true ) ).rejects.toThrow();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when PM2 connection fails', async () => {
			( connect as jest.Mock ).mockRejectedValue( new Error( 'PM2 connection failed' ) );

			const { runCommand } = await import( '../set-https' );

			await expect( runCommand( mockSiteFolder, true ) ).rejects.toThrow();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when stopping running site fails', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );
			( stopWordPressServer as jest.Mock ).mockRejectedValue( new Error( 'Server stop failed' ) );

			const { runCommand } = await import( '../set-https' );

			await expect( runCommand( mockSiteFolder, true ) ).rejects.toThrow();
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should enable HTTPS on a stopped site', async () => {
			const { runCommand } = await import( '../set-https' );

			await runCommand( mockSiteFolder, true );

			expect( lockAppdata ).toHaveBeenCalled();
			expect( readAppdata ).toHaveBeenCalled();
			expect( saveAppdata ).toHaveBeenCalled();

			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].enableHttps ).toBe( true );

			expect( unlockAppdata ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledWith( mockSiteData.id );
			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should disable HTTPS on a stopped site', async () => {
			const siteWithHttps = { ...mockSiteData, enableHttps: true };
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ siteWithHttps ],
				snapshots: [],
			} );

			const { runCommand } = await import( '../set-https' );

			await runCommand( mockSiteFolder, false );

			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].enableHttps ).toBe( false );

			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should enable HTTPS and restart a running site', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );

			const { runCommand } = await import( '../set-https' );

			await runCommand( mockSiteFolder, true );

			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].enableHttps ).toBe( true );

			expect( isServerRunning ).toHaveBeenCalledWith( mockSiteData.id );
			expect( stopWordPressServer ).toHaveBeenCalledWith( mockSiteData.id );
			expect( startWordPressServer ).toHaveBeenCalledWith( expect.any( Object ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should disable HTTPS and restart a running site', async () => {
			const siteWithHttps = { ...mockSiteData, enableHttps: true };
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ siteWithHttps ],
				snapshots: [],
			} );
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );

			const { runCommand } = await import( '../set-https' );

			await runCommand( mockSiteFolder, false );

			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].enableHttps ).toBe( false );

			expect( isServerRunning ).toHaveBeenCalledWith( mockSiteData.id );
			expect( stopWordPressServer ).toHaveBeenCalledWith( mockSiteData.id );
			expect( startWordPressServer ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );
} );
