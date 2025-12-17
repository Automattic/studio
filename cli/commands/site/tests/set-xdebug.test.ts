import { arePathsEqual } from 'common/lib/fs-utils';
import {
	isXdebugBetaEnabled,
	lockAppdata,
	readAppdata,
	saveAppdata,
	SiteData,
	unlockAppdata,
	updateSiteLatestCliPid,
} from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';

jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	isXdebugBetaEnabled: jest.fn(),
	lockAppdata: jest.fn(),
	readAppdata: jest.fn(),
	saveAppdata: jest.fn(),
	unlockAppdata: jest.fn(),
	updateSiteLatestCliPid: jest.fn(),
} ) );
jest.mock( 'cli/lib/pm2-manager' );
jest.mock( 'cli/lib/wordpress-server-manager' );
jest.mock( 'common/lib/fs-utils' );

describe( 'CLI: studio site set-xdebug', () => {
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
		enableXdebug: false,
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

		( isXdebugBetaEnabled as jest.Mock ).mockResolvedValue( true );
		( connect as jest.Mock ).mockResolvedValue( undefined );
		( disconnect as jest.Mock ).mockReturnValue( undefined );
		( lockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( readAppdata as jest.Mock ).mockResolvedValue( {
			sites: [ mockSiteData ],
			snapshots: [],
		} );
		( saveAppdata as jest.Mock ).mockResolvedValue( undefined );
		( unlockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( updateSiteLatestCliPid as jest.Mock ).mockResolvedValue( undefined );
		( isServerRunning as jest.Mock ).mockResolvedValue( undefined );
		( startWordPressServer as jest.Mock ).mockResolvedValue( mockProcessDescription );
		( stopWordPressServer as jest.Mock ).mockResolvedValue( undefined );
		( arePathsEqual as jest.Mock ).mockImplementation( ( a: string, b: string ) => a === b );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'should throw when beta feature is not enabled', async () => {
			( isXdebugBetaEnabled as jest.Mock ).mockResolvedValue( false );

			const { runCommand } = await import( '../set-xdebug' );

			await expect( runCommand( mockSiteFolder, true ) ).rejects.toThrow(
				'Xdebug support is a beta feature. Enable it in Studio settings first.'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when site not found', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [],
				snapshots: [],
			} );

			const { runCommand } = await import( '../set-xdebug' );

			await expect( runCommand( mockSiteFolder, true ) ).rejects.toThrow(
				'The specified folder is not added to Studio.'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when another site already has xdebug enabled', async () => {
			const otherSite = {
				...createMockSiteData(),
				id: 'other-site-id',
				name: 'Other Site',
				path: '/other/site/path',
				enableXdebug: true,
			};
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockSiteData, otherSite ],
				snapshots: [],
			} );

			const { runCommand } = await import( '../set-xdebug' );

			await expect( runCommand( mockSiteFolder, true ) ).rejects.toThrow(
				'Only one site can have Xdebug enabled at a time. Disable Xdebug on "Other Site" first.'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw if xdebug is already enabled', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ { ...mockSiteData, enableXdebug: true } ],
				snapshots: [],
			} );

			const { runCommand } = await import( '../set-xdebug' );

			await expect( runCommand( mockSiteFolder, true ) ).rejects.toThrow(
				'Xdebug is already enabled for this site.'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw if xdebug is already disabled', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ { ...mockSiteData, enableXdebug: false } ],
				snapshots: [],
			} );

			const { runCommand } = await import( '../set-xdebug' );

			await expect( runCommand( mockSiteFolder, false ) ).rejects.toThrow(
				'Xdebug is already disabled for this site.'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when appdata save fails', async () => {
			( saveAppdata as jest.Mock ).mockRejectedValue( new Error( 'Save failed' ) );

			const { runCommand } = await import( '../set-xdebug' );

			await expect( runCommand( mockSiteFolder, true ) ).rejects.toThrow();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when PM2 connection fails', async () => {
			( connect as jest.Mock ).mockRejectedValue( new Error( 'PM2 connection failed' ) );

			const { runCommand } = await import( '../set-xdebug' );

			await expect( runCommand( mockSiteFolder, true ) ).rejects.toThrow();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when stopping running site fails', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );
			( stopWordPressServer as jest.Mock ).mockRejectedValue( new Error( 'Server stop failed' ) );

			const { runCommand } = await import( '../set-xdebug' );

			await expect( runCommand( mockSiteFolder, true ) ).rejects.toThrow();
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should enable xdebug on a stopped site', async () => {
			const { runCommand } = await import( '../set-xdebug' );

			await runCommand( mockSiteFolder, true );

			expect( lockAppdata ).toHaveBeenCalled();
			expect( readAppdata ).toHaveBeenCalled();
			expect( saveAppdata ).toHaveBeenCalled();

			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].enableXdebug ).toBe( true );

			expect( unlockAppdata ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledWith( mockSiteData.id );
			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( updateSiteLatestCliPid ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should disable xdebug on a stopped site', async () => {
			const siteWithXdebug = { ...mockSiteData, enableXdebug: true };
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ siteWithXdebug ],
				snapshots: [],
			} );

			const { runCommand } = await import( '../set-xdebug' );

			await runCommand( mockSiteFolder, false );

			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].enableXdebug ).toBe( false );

			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( updateSiteLatestCliPid ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should enable xdebug and restart a running site', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );

			const { runCommand } = await import( '../set-xdebug' );

			await runCommand( mockSiteFolder, true );

			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].enableXdebug ).toBe( true );

			expect( isServerRunning ).toHaveBeenCalledWith( mockSiteData.id );
			expect( stopWordPressServer ).toHaveBeenCalledWith( mockSiteData.id );
			expect( startWordPressServer ).toHaveBeenCalledWith(
				expect.any( Object ),
				expect.any( Logger )
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should disable xdebug and restart a running site', async () => {
			const siteWithXdebug = { ...mockSiteData, enableXdebug: true };
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ siteWithXdebug ],
				snapshots: [],
			} );
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );

			const { runCommand } = await import( '../set-xdebug' );

			await runCommand( mockSiteFolder, false );

			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].enableXdebug ).toBe( false );

			expect( isServerRunning ).toHaveBeenCalledWith( mockSiteData.id );
			expect( stopWordPressServer ).toHaveBeenCalledWith( mockSiteData.id );
			expect( startWordPressServer ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should update latestCliPid after restarting a running site', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );

			const { runCommand } = await import( '../set-xdebug' );

			await runCommand( mockSiteFolder, true );

			expect( updateSiteLatestCliPid ).toHaveBeenCalledWith(
				mockSiteData.id,
				mockProcessDescription.pid
			);
		} );

		it( 'should not update latestCliPid if process has no pid', async () => {
			const processWithoutPid = { ...mockProcessDescription, pid: undefined };
			( isServerRunning as jest.Mock ).mockResolvedValue( processWithoutPid );
			( startWordPressServer as jest.Mock ).mockResolvedValue( processWithoutPid );

			const { runCommand } = await import( '../set-xdebug' );

			await runCommand( mockSiteFolder, true );

			expect( updateSiteLatestCliPid ).not.toHaveBeenCalled();
		} );
	} );
} );
