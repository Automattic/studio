import fs from 'fs';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import trash from 'trash';
import { vi } from 'vitest';
import { deleteSnapshot } from 'cli/lib/api';
import { getAuthToken } from 'cli/lib/appdata';
import { deleteSiteCertificate } from 'cli/lib/certificate-manager';
import {
	SiteData,
	getSiteByFolder,
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
} from 'cli/lib/cli-config';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { removeDomainFromHosts } from 'cli/lib/hosts-file';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { getSnapshotsFromAppdata, deleteSnapshotFromAppdata } from 'cli/lib/snapshots';
import { ProcessDescription } from 'cli/lib/types/process-manager-ipc';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { runCommand } from '../delete';

vi.mock( 'fs/promises' );
vi.mock( 'cli/lib/api' );
vi.mock( 'cli/lib/appdata', async () => {
	const actual = await vi.importActual( 'cli/lib/appdata' );
	return {
		...actual,
		getAuthToken: vi.fn(),
	};
} );
vi.mock( 'cli/lib/cli-config', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config' );
	return {
		...actual,
		getSiteByFolder: vi.fn(),
		lockCliConfig: vi.fn(),
		readCliConfig: vi.fn(),
		saveCliConfig: vi.fn(),
		unlockCliConfig: vi.fn(),
	};
} );
vi.mock( 'cli/lib/certificate-manager' );
vi.mock( 'cli/lib/hosts-file' );
vi.mock( 'cli/lib/daemon-client' );
vi.mock( 'cli/lib/site-utils' );
vi.mock( 'cli/lib/snapshots' );
vi.mock( 'cli/lib/wordpress-server-manager' );
vi.mock( '@studio/common/lib/fs-utils' );
vi.mock( 'trash' );

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

	const testProcessDescription: ProcessDescription = {
		name: 'test-site-id',
		pmId: 0,
		status: 'online',
		pid: 12345,
	};

	const testAuthToken = {
		accessToken: 'test-access-token',
		id: 12345,
		expiresIn: 1209600,
		expirationTime: 1234567890000 + 1209600000,
		email: 'test@example.com',
		displayName: 'Test User',
	};

	const testSnapshot1 = {
		url: 'https://preview1.example.com',
		atomicSiteId: 123456,
		localSiteId: 'test-site-id',
		date: 1234567890000,
		name: 'Test Site Preview 1',
		sequence: 1,
		userId: 12345,
	};

	const testSnapshot2 = {
		url: 'https://preview2.example.com',
		atomicSiteId: 123457,
		localSiteId: 'test-site-id',
		date: 1234567890000,
		name: 'Test Site Preview 2',
		sequence: 2,
		userId: 12345,
	};

	let testSite: SiteData;

	beforeEach( () => {
		vi.clearAllMocks();

		testSite = createTestSite();

		vi.mocked( getSiteByFolder ).mockResolvedValue( testSite );
		vi.mocked( connectToDaemon ).mockResolvedValue( undefined );
		vi.mocked( disconnectFromDaemon ).mockResolvedValue( undefined );
		vi.mocked( getAuthToken ).mockResolvedValue( testAuthToken );
		vi.mocked( lockCliConfig ).mockResolvedValue( undefined );
		vi.mocked( readCliConfig, { partial: true } ).mockResolvedValue( {
			version: 1,
			sites: [ testSite ],
		} );
		vi.mocked( saveCliConfig ).mockResolvedValue( undefined );
		vi.mocked( unlockCliConfig ).mockResolvedValue( undefined );
		vi.mocked( isServerRunning ).mockResolvedValue( undefined );
		vi.mocked( stopWordPressServer ).mockResolvedValue( undefined );
		vi.mocked( removeDomainFromHosts ).mockResolvedValue( undefined );
		vi.mocked( deleteSiteCertificate ).mockReturnValue( true );
		vi.mocked( getSnapshotsFromAppdata ).mockResolvedValue( [] );
		vi.mocked( deleteSnapshot ).mockResolvedValue( undefined );
		vi.mocked( deleteSnapshotFromAppdata ).mockResolvedValue( undefined );
		vi.mocked( stopProxyIfNoSitesNeedIt ).mockResolvedValue( undefined );
		vi.mocked( arePathsEqual ).mockImplementation( ( a: string, b: string ) => a === b );
		vi.spyOn( fs, 'existsSync' ).mockReturnValue( true );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'should throw when process manager connection fails', async () => {
			vi.mocked( connectToDaemon ).mockRejectedValue(
				new Error( 'process manager connection failed' )
			);

			await expect( runCommand( testSiteFolder ) ).rejects.toThrow();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should throw when appdata read fails', async () => {
			vi.mocked( readCliConfig ).mockRejectedValue( new Error( 'Read failed' ) );

			await expect( runCommand( testSiteFolder ) ).rejects.toThrow();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should throw when site not found in appdata', async () => {
			vi.mocked( readCliConfig, { partial: true } ).mockResolvedValue( {
				version: 1,
				sites: [],
			} );

			await expect( runCommand( testSiteFolder ) ).rejects.toThrow(
				'The specified directory is not added to Studio.'
			);
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should throw when WordPress server stop fails', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );
			vi.mocked( stopWordPressServer ).mockRejectedValue( new Error( 'Server stop failed' ) );

			await expect( runCommand( testSiteFolder ) ).rejects.toThrow();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should throw when file deletion fails', async () => {
			vi.mocked( trash ).mockRejectedValueOnce( new Error( 'File deletion failed' ) );

			await expect( runCommand( testSiteFolder, true ) ).rejects.toThrow( 'File deletion failed' );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should proceed when getAuthToken fails', async () => {
			vi.mocked( getAuthToken ).mockRejectedValue( new Error( 'Auth failed' ) );
			vi.mocked( getSnapshotsFromAppdata ).mockResolvedValue( [] );

			await expect( runCommand( testSiteFolder, false ) ).resolves.not.toThrow();
			expect( saveCliConfig ).toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should delete a stopped site without removing files and no preview sites', async () => {
			vi.mocked( getSnapshotsFromAppdata ).mockResolvedValue( [] );

			await runCommand( testSiteFolder, false );

			expect( connectToDaemon ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledWith( testSite.id );
			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( lockCliConfig ).toHaveBeenCalled();
			expect( readCliConfig ).toHaveBeenCalled();
			expect( saveCliConfig ).toHaveBeenCalled();
			const savedCliConfig = vi.mocked( saveCliConfig ).mock.calls[ 0 ][ 0 ];
			expect( savedCliConfig.sites ).toHaveLength( 0 );
			expect( unlockCliConfig ).toHaveBeenCalled();
			expect( deleteSnapshot ).not.toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should delete a running site and stop it first', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );
			vi.mocked( getSnapshotsFromAppdata ).mockResolvedValue( [] );

			await runCommand( testSiteFolder, false );

			expect( isServerRunning ).toHaveBeenCalledWith( testSite.id );
			expect( stopWordPressServer ).toHaveBeenCalledWith( testSite.id );
			expect( saveCliConfig ).toHaveBeenCalled();
			const savedCliConfig = vi.mocked( saveCliConfig ).mock.calls[ 0 ][ 0 ];
			expect( savedCliConfig.sites ).toHaveLength( 0 );
			expect( stopProxyIfNoSitesNeedIt ).toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should delete a site and remove files when files flag is set', async () => {
			vi.mocked( getSnapshotsFromAppdata ).mockResolvedValue( [] );

			await runCommand( testSiteFolder, true );

			expect( saveCliConfig ).toHaveBeenCalled();
			const savedCliConfig = vi.mocked( saveCliConfig ).mock.calls[ 0 ][ 0 ];
			expect( savedCliConfig.sites ).toHaveLength( 0 );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should delete associated preview sites', async () => {
			vi.mocked( getSnapshotsFromAppdata ).mockResolvedValue( [ testSnapshot1, testSnapshot2 ] );

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
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should delete a running site and remove files along with preview sites', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );
			vi.mocked( getSnapshotsFromAppdata ).mockResolvedValue( [ testSnapshot1 ] );

			await runCommand( testSiteFolder, true );

			expect( stopWordPressServer ).toHaveBeenCalledWith( testSite.id );
			expect( deleteSnapshot ).toHaveBeenCalledWith(
				testSnapshot1.atomicSiteId,
				testAuthToken.accessToken
			);
			expect( deleteSnapshotFromAppdata ).toHaveBeenCalledWith( testSnapshot1.url );
			expect( stopProxyIfNoSitesNeedIt ).toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should remove custom domain from hosts file if present', async () => {
			testSite = createTestSite( { customDomain: 'example.local' } );
			vi.mocked( getSiteByFolder ).mockResolvedValue( testSite );
			vi.mocked( readCliConfig, { partial: true } ).mockResolvedValue( {
				version: 1,
				sites: [ testSite ],
			} );
			vi.mocked( getSnapshotsFromAppdata ).mockResolvedValue( [] );

			await runCommand( testSiteFolder, false );

			expect( removeDomainFromHosts ).toHaveBeenCalledWith( 'example.local' );
			expect( deleteSnapshot ).not.toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should delete SSL certificate if custom domain and HTTPS are enabled', async () => {
			testSite = createTestSite( { customDomain: 'example.local', enableHttps: true } );
			vi.mocked( getSiteByFolder ).mockResolvedValue( testSite );
			vi.mocked( readCliConfig, { partial: true } ).mockResolvedValue( {
				version: 1,
				sites: [ testSite ],
			} );
			vi.mocked( getSnapshotsFromAppdata ).mockResolvedValue( [] );

			await runCommand( testSiteFolder, false );

			expect( removeDomainFromHosts ).toHaveBeenCalledWith( 'example.local' );
			expect( deleteSiteCertificate ).toHaveBeenCalledWith( 'example.local' );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should skip file deletion when site directory no longer exists', async () => {
			vi.spyOn( fs, 'existsSync' ).mockReturnValue( false );
			vi.mocked( getSnapshotsFromAppdata ).mockResolvedValue( [] );

			await runCommand( testSiteFolder, true );

			expect( saveCliConfig ).toHaveBeenCalled();
			const savedCliConfig = vi.mocked( saveCliConfig ).mock.calls[ 0 ][ 0 ];
			expect( savedCliConfig.sites ).toHaveLength( 0 );
			expect( trash ).not.toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should not remove domain or certificate if no custom domain', async () => {
			vi.mocked( getSnapshotsFromAppdata ).mockResolvedValue( [] );

			await runCommand( testSiteFolder, false );

			expect( removeDomainFromHosts ).not.toHaveBeenCalled();
			expect( deleteSiteCertificate ).not.toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );
	} );
} );
