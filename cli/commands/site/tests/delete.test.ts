import { arePathsEqual } from 'common/lib/fs-utils';
import { deleteSnapshot } from 'cli/lib/api';
import {
	SiteData,
	getSiteByFolder,
	lockAppdata,
	readAppdata,
	saveAppdata,
	unlockAppdata,
	getAuthToken,
} from 'cli/lib/appdata';
import { deleteSiteCertificate } from 'cli/lib/certificate-manager';
import { removeDomainFromHosts } from 'cli/lib/hosts-file';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { getSnapshotsFromAppdata, deleteSnapshotFromAppdata } from 'cli/lib/snapshots';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { runCommand } from '../delete';

jest.mock( 'fs/promises' );
jest.mock( 'cli/lib/api' );
jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	getSiteByFolder: jest.fn(),
	lockAppdata: jest.fn(),
	readAppdata: jest.fn(),
	saveAppdata: jest.fn(),
	unlockAppdata: jest.fn(),
	getAuthToken: jest.fn(),
} ) );
jest.mock( 'cli/lib/certificate-manager' );
jest.mock( 'cli/lib/hosts-file' );
jest.mock( 'cli/lib/pm2-manager' );
jest.mock( 'cli/lib/site-utils' );
jest.mock( 'cli/lib/snapshots' );
jest.mock( 'cli/lib/wordpress-server-manager' );
jest.mock( 'common/lib/fs-utils' );
jest.mock( 'trash' );

describe( 'CLI: studio site delete', () => {
	const testSiteFolder = '/test/site/path';

	const createTestSite = ( overrides?: Partial< SiteData > ): SiteData => ( {
		id: 'test-site-id',
		name: 'Test Site',
		path: testSiteFolder,
		port: 8881,
		phpVersion: '8.0',
		...overrides,
	} );

	const testProcessDescription = {
		name: 'test-site-id',
		pmId: 0,
		status: 'online',
		pid: 12345,
	};

	const testAuthToken = {
		accessToken: 'test-access-token',
		id: 12345,
		expiresIn: 1209600,
		expirationTime: Date.now() + 1209600000,
		email: 'test@example.com',
		displayName: 'Test User',
	};

	const testSnapshot1 = {
		url: 'https://preview1.example.com',
		atomicSiteId: 123456,
		localSiteId: 'test-site-id',
		date: Date.now(),
		name: 'Test Site Preview 1',
		sequence: 1,
		userId: 12345,
	};

	const testSnapshot2 = {
		url: 'https://preview2.example.com',
		atomicSiteId: 123457,
		localSiteId: 'test-site-id',
		date: Date.now(),
		name: 'Test Site Preview 2',
		sequence: 2,
		userId: 12345,
	};

	let testSite: SiteData;

	beforeEach( () => {
		jest.clearAllMocks();

		testSite = createTestSite();

		( getSiteByFolder as jest.Mock ).mockResolvedValue( testSite );
		( connect as jest.Mock ).mockResolvedValue( undefined );
		( disconnect as jest.Mock ).mockReturnValue( undefined );
		( getAuthToken as jest.Mock ).mockResolvedValue( testAuthToken );
		( lockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( readAppdata as jest.Mock ).mockResolvedValue( {
			sites: [ testSite ],
			snapshots: [],
		} );
		( saveAppdata as jest.Mock ).mockResolvedValue( undefined );
		( unlockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( isServerRunning as jest.Mock ).mockResolvedValue( undefined );
		( stopWordPressServer as jest.Mock ).mockResolvedValue( undefined );
		( removeDomainFromHosts as jest.Mock ).mockResolvedValue( undefined );
		( deleteSiteCertificate as jest.Mock ).mockResolvedValue( undefined );
		( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( [] );
		( deleteSnapshot as jest.Mock ).mockResolvedValue( undefined );
		( deleteSnapshotFromAppdata as jest.Mock ).mockResolvedValue( undefined );
		( stopProxyIfNoSitesNeedIt as jest.Mock ).mockResolvedValue( undefined );
		( arePathsEqual as jest.Mock ).mockImplementation( ( a: string, b: string ) => a === b );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'should throw when PM2 connection fails', async () => {
			( connect as jest.Mock ).mockRejectedValue( new Error( 'PM2 connection failed' ) );

			await expect( runCommand( testSiteFolder ) ).rejects.toThrow();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when appdata read fails', async () => {
			( readAppdata as jest.Mock ).mockRejectedValue( new Error( 'Read failed' ) );

			await expect( runCommand( testSiteFolder ) ).rejects.toThrow();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when site not found in appdata', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [],
				snapshots: [],
			} );

			await expect( runCommand( testSiteFolder ) ).rejects.toThrow(
				'The specified folder is not added to Studio.'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when WordPress server stop fails', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );
			( stopWordPressServer as jest.Mock ).mockRejectedValue( new Error( 'Server stop failed' ) );

			await expect( runCommand( testSiteFolder ) ).rejects.toThrow();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when file deletion fails', async () => {
			jest.mock( 'trash', () => ( {
				__esModule: true,
				default: jest.fn().mockRejectedValueOnce( new Error( 'File deletion failed' ) ),
			} ) );

			await expect( runCommand( testSiteFolder, true ) ).rejects.toThrow( 'File deletion failed' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should proceed when getAuthToken fails', async () => {
			( getAuthToken as jest.Mock ).mockRejectedValue( new Error( 'Auth failed' ) );
			( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( [] );

			await expect( runCommand( testSiteFolder, false ) ).resolves.not.toThrow();
			expect( saveAppdata ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should delete a stopped site without removing files and no preview sites', async () => {
			( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( [] );

			await runCommand( testSiteFolder, false );

			expect( connect ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledWith( testSite.id );
			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( lockAppdata ).toHaveBeenCalled();
			expect( readAppdata ).toHaveBeenCalled();
			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites ).toHaveLength( 0 );
			expect( unlockAppdata ).toHaveBeenCalled();
			expect( deleteSnapshot ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should delete a running site and stop it first', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );
			( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( [] );

			await runCommand( testSiteFolder, false );

			expect( isServerRunning ).toHaveBeenCalledWith( testSite.id );
			expect( stopWordPressServer ).toHaveBeenCalledWith( testSite.id );
			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites ).toHaveLength( 0 );
			expect( stopProxyIfNoSitesNeedIt ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should delete a site and remove files when files flag is set', async () => {
			( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( [] );

			await runCommand( testSiteFolder, true );

			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites ).toHaveLength( 0 );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should delete associated preview sites', async () => {
			( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( [
				testSnapshot1,
				testSnapshot2,
			] );

			await runCommand( testSiteFolder );

			expect( getSnapshotsFromAppdata ).toHaveBeenCalledWith( testAuthToken.id, testSiteFolder );
			expect( deleteSnapshot ).toHaveBeenCalledWith(
				testSnapshot1.atomicSiteId,
				testAuthToken.accessToken
			);
			expect( deleteSnapshot ).toHaveBeenCalledWith(
				testSnapshot2.atomicSiteId,
				testAuthToken.accessToken
			);
			expect( deleteSnapshotFromAppdata ).toHaveBeenCalledWith( testSnapshot1.url );
			expect( deleteSnapshotFromAppdata ).toHaveBeenCalledWith( testSnapshot2.url );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should delete a running site and remove files along with preview sites', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );
			( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( [ testSnapshot1 ] );

			await runCommand( testSiteFolder, true );

			expect( stopWordPressServer ).toHaveBeenCalledWith( testSite.id );
			expect( deleteSnapshot ).toHaveBeenCalledWith(
				testSnapshot1.atomicSiteId,
				testAuthToken.accessToken
			);
			expect( deleteSnapshotFromAppdata ).toHaveBeenCalledWith( testSnapshot1.url );
			expect( stopProxyIfNoSitesNeedIt ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should remove custom domain from hosts file if present', async () => {
			testSite = createTestSite( { customDomain: 'example.local' } );
			( getSiteByFolder as jest.Mock ).mockResolvedValue( testSite );
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ testSite ],
				snapshots: [],
			} );
			( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( [] );

			await runCommand( testSiteFolder, false );

			expect( removeDomainFromHosts ).toHaveBeenCalledWith( 'example.local' );
			expect( deleteSnapshot ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should delete SSL certificate if custom domain and HTTPS are enabled', async () => {
			testSite = createTestSite( { customDomain: 'example.local', enableHttps: true } );
			( getSiteByFolder as jest.Mock ).mockResolvedValue( testSite );
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ testSite ],
				snapshots: [],
			} );
			( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( [] );

			await runCommand( testSiteFolder, false );

			expect( removeDomainFromHosts ).toHaveBeenCalledWith( 'example.local' );
			expect( deleteSiteCertificate ).toHaveBeenCalledWith( 'example.local' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should not remove domain or certificate if no custom domain', async () => {
			( getSnapshotsFromAppdata as jest.Mock ).mockResolvedValue( [] );

			await runCommand( testSiteFolder, false );

			expect( removeDomainFromHosts ).not.toHaveBeenCalled();
			expect( deleteSiteCertificate ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );
} );
