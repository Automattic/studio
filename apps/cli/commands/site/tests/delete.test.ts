import fs from 'fs';
import { deleteAiSessionsForSite } from '@studio/common/ai/sessions/manage';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { removeAllConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { SITE_RUNTIME_PLAYGROUND } from '@studio/common/lib/site-runtime';
import trash from 'trash';
import { vi } from 'vitest';
import { deleteSnapshot } from 'cli/lib/api';
import { deleteSiteCertificate } from 'cli/lib/certificate-manager';
import {
	SiteData,
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon, emitCliEvent } from 'cli/lib/daemon-client';
import { removeDomainFromHosts } from 'cli/lib/hosts-file';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { getSnapshotsFromConfig, deleteSnapshotFromConfig } from 'cli/lib/snapshots';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { ProcessDescription } from 'cli/lib/types/process-manager-ipc';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { runCommand, runDeleteCommand } from '../delete';

vi.mock( 'fs' );
vi.mock( 'cli/lib/api' );
vi.mock( '@studio/common/ai/sessions/manage' );
vi.mock( '@studio/common/lib/connected-sites', () => ( {
	removeAllConnectedWpcomSitesForLocalSite: vi.fn(),
} ) );
vi.mock( import( '@studio/common/lib/shared-config' ), async ( importOriginal ) => ( {
	...( await importOriginal() ),
	readAuthToken: vi.fn(),
} ) );
vi.mock( 'cli/lib/cli-config/core', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config/core' );
	return {
		...actual,
		lockCliConfig: vi.fn(),
		readCliConfig: vi.fn(),
		saveCliConfig: vi.fn(),
		unlockCliConfig: vi.fn(),
	};
} );
vi.mock( 'cli/lib/cli-config/sites', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config/sites' );
	return {
		...actual,
		getSiteByFolder: vi.fn(),
	};
} );
vi.mock( 'cli/lib/certificate-manager' );
vi.mock( 'cli/lib/hosts-file' );
vi.mock( 'cli/lib/daemon-client' );
// Run the command body directly: these suites cover the command, not the
// operation guard (lib/tests/site-operations.test.ts does that). Spreading the real module keeps
// any other export real rather than silently stubbing it.
vi.mock( 'cli/lib/site-operations', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/site-operations') >() ),
	withSiteOperation: ( _folder: string, _kind: string, fn: () => unknown ) => fn(),
	withSiteOperations: ( _ids: string[], _kind: string, fn: () => unknown ) => fn(),
} ) );
vi.mock( 'cli/lib/site-utils' );
vi.mock( 'cli/lib/snapshots' );
vi.mock( 'cli/lib/wordpress-server-manager' );
vi.mock( '@studio/common/lib/fs-utils' );
vi.mock( 'trash' );
vi.mock( 'cli/lib/tracks', async ( importActual ) => {
	const actual = await importActual< typeof import('cli/lib/tracks') >();
	return { ...actual, recordTracksEvent: vi.fn() };
} );

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
		runtime: SITE_RUNTIME_PLAYGROUND,
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
	const originalExitCode = process.exitCode;

	beforeEach( () => {
		vi.clearAllMocks();
		process.exitCode = originalExitCode;

		testSite = createTestSite();

		vi.mocked( getSiteByFolder ).mockResolvedValue( testSite );
		vi.mocked( connectToDaemon ).mockResolvedValue( undefined );
		vi.mocked( disconnectFromDaemon ).mockResolvedValue( undefined );
		vi.mocked( readAuthToken ).mockResolvedValue( testAuthToken );
		vi.mocked( lockCliConfig ).mockResolvedValue( undefined );
		vi.mocked( readCliConfig, { partial: true } ).mockResolvedValue( {
			version: 1,
			sites: [ testSite ],
			snapshots: [],
		} );
		vi.mocked( saveCliConfig ).mockResolvedValue( undefined );
		vi.mocked( unlockCliConfig ).mockResolvedValue( undefined );
		vi.mocked( isServerRunning ).mockResolvedValue( undefined );
		vi.mocked( stopWordPressServer ).mockResolvedValue( undefined );
		vi.mocked( removeDomainFromHosts ).mockResolvedValue( undefined );
		vi.mocked( deleteSiteCertificate ).mockReturnValue( true );
		vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [] );
		vi.mocked( deleteSnapshot ).mockResolvedValue( undefined );
		vi.mocked( deleteSnapshotFromConfig ).mockResolvedValue( undefined );
		vi.mocked( stopProxyIfNoSitesNeedIt ).mockResolvedValue( undefined );
		vi.mocked( arePathsEqual ).mockImplementation( ( a: string, b: string ) => a === b );
		vi.mocked( deleteAiSessionsForSite ).mockResolvedValue( [] );
		vi.mocked( removeAllConnectedWpcomSitesForLocalSite ).mockResolvedValue( undefined );
		vi.spyOn( fs, 'existsSync' ).mockReturnValue( true );
	} );

	afterEach( () => {
		process.exitCode = originalExitCode;
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
			expect( connectToDaemon ).not.toHaveBeenCalled();
			expect( disconnectFromDaemon ).not.toHaveBeenCalled();
		} );

		it( 'should throw when site not found in appdata', async () => {
			vi.mocked( readCliConfig, { partial: true } ).mockResolvedValue( {
				version: 1,
				sites: [],
				snapshots: [],
			} );

			await expect( runCommand( testSiteFolder ) ).rejects.toThrow(
				'The specified directory is not added to Studio.'
			);
			expect( connectToDaemon ).not.toHaveBeenCalled();
			expect( disconnectFromDaemon ).not.toHaveBeenCalled();
		} );

		it( 'should throw when WordPress server stop fails', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );
			vi.mocked( stopWordPressServer ).mockRejectedValue( new Error( 'Server stop failed' ) );

			await expect( runCommand( testSiteFolder ) ).rejects.toThrow();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should proceed when readAuthToken returns null', async () => {
			vi.mocked( readAuthToken ).mockResolvedValue( null );
			vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [] );

			await expect( runCommand( testSiteFolder, false ) ).resolves.not.toThrow();
			expect( saveCliConfig ).toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should delete a stopped site without removing files and no preview sites', async () => {
			vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [] );

			await runCommand( testSiteFolder, false );

			expect( connectToDaemon ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledWith( testSite.id );
			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( lockCliConfig ).toHaveBeenCalled();
			expect( readCliConfig ).toHaveBeenCalled();
			expect( saveCliConfig ).toHaveBeenCalled();
			expect( removeAllConnectedWpcomSitesForLocalSite ).toHaveBeenCalledWith( testSite.id );
			const savedCliConfig = vi.mocked( saveCliConfig ).mock.calls[ 0 ][ 0 ];
			expect( savedCliConfig.sites ).toHaveLength( 0 );
			expect( unlockCliConfig ).toHaveBeenCalled();
			expect( deleteSnapshot ).not.toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should delete a running site and stop it first', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );
			vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [] );

			await runCommand( testSiteFolder, false );

			expect( isServerRunning ).toHaveBeenCalledWith( testSite.id );
			expect( stopWordPressServer ).toHaveBeenCalledWith( testSite.id );
			expect( saveCliConfig ).toHaveBeenCalled();
			const savedCliConfig = vi.mocked( saveCliConfig ).mock.calls[ 0 ][ 0 ];
			expect( savedCliConfig.sites ).toHaveLength( 0 );
			expect( stopProxyIfNoSitesNeedIt ).toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should move files to trash by default', async () => {
			vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [] );

			await runCommand( testSiteFolder );

			expect( trash ).toHaveBeenCalledWith( [ testSiteFolder ] );
			expect( saveCliConfig ).toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should not move files to trash when --no-files is used', async () => {
			vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [] );

			await runCommand( testSiteFolder, false );

			expect( trash ).not.toHaveBeenCalled();
			expect( saveCliConfig ).toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should delete both the visible site and the technical import directory', async () => {
			testSite = createTestSite( { technicalSiteDirectory: '/test/.studio/imports/site' } );
			vi.mocked( getSiteByFolder ).mockResolvedValue( testSite );
			vi.mocked( readCliConfig, { partial: true } ).mockResolvedValue( {
				version: 1,
				sites: [ testSite ],
				snapshots: [],
			} );
			vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [] );
			vi.spyOn( fs, 'existsSync' ).mockImplementation(
				( filePath ) => filePath === testSiteFolder || filePath === '/test/.studio/imports/site'
			);

			await runCommand( testSiteFolder, true );

			expect( trash ).toHaveBeenCalledWith( [ testSiteFolder, '/test/.studio/imports/site' ] );
		} );

		it( 'should delete associated preview sites', async () => {
			vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [ testSnapshot1, testSnapshot2 ] );

			await runCommand( testSiteFolder );

			expect( getSnapshotsFromConfig ).toHaveBeenCalledWith( testAuthToken.id, testSiteFolder );
			expect( deleteSnapshot ).toHaveBeenCalledWith(
				testSnapshot1.atomicSiteId,
				testAuthToken.accessToken
			);
			expect( deleteSnapshot ).toHaveBeenCalledWith(
				testSnapshot2.atomicSiteId,
				testAuthToken.accessToken
			);
			expect( deleteSnapshotFromConfig ).toHaveBeenCalledWith( testSnapshot1.url );
			expect( deleteSnapshotFromConfig ).toHaveBeenCalledWith( testSnapshot2.url );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should delete a running site and remove files along with preview sites', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );
			vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [ testSnapshot1 ] );

			await runCommand( testSiteFolder, true );

			expect( stopWordPressServer ).toHaveBeenCalledWith( testSite.id );
			expect( deleteSnapshot ).toHaveBeenCalledWith(
				testSnapshot1.atomicSiteId,
				testAuthToken.accessToken
			);
			expect( deleteSnapshotFromConfig ).toHaveBeenCalledWith( testSnapshot1.url );
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
			vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [] );

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
			vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [] );

			await runCommand( testSiteFolder, false );

			expect( removeDomainFromHosts ).toHaveBeenCalledWith( 'example.local' );
			expect( deleteSiteCertificate ).toHaveBeenCalledWith( 'example.local' );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should skip file deletion when site directory no longer exists', async () => {
			vi.spyOn( fs, 'existsSync' ).mockReturnValue( false );
			vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [] );

			await runCommand( testSiteFolder, true );

			expect( saveCliConfig ).toHaveBeenCalled();
			const savedCliConfig = vi.mocked( saveCliConfig ).mock.calls[ 0 ][ 0 ];
			expect( savedCliConfig.sites ).toHaveLength( 0 );
			expect( trash ).not.toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should delete the chat sessions associated with the site', async () => {
			await runCommand( testSiteFolder, false );

			expect( deleteAiSessionsForSite ).toHaveBeenCalledWith( expect.any( String ), {
				id: testSite.id,
				path: testSite.path,
			} );
		} );

		it( 'should proceed when deleting chat sessions fails', async () => {
			vi.mocked( deleteAiSessionsForSite ).mockRejectedValue( new Error( 'delete failed' ) );

			await expect( runCommand( testSiteFolder, true ) ).resolves.not.toThrow();
			expect( trash ).toHaveBeenCalledWith( [ testSiteFolder ] );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should proceed when deleting WordPress.com connections fails', async () => {
			vi.mocked( removeAllConnectedWpcomSitesForLocalSite ).mockRejectedValue(
				new Error( 'shared config failed' )
			);

			await expect( runCommand( testSiteFolder, true ) ).resolves.not.toThrow();
			expect( saveCliConfig ).toHaveBeenCalled();
			expect( trash ).toHaveBeenCalledWith( [ testSiteFolder ] );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should proceed and still emit the deleted event when moving files to trash fails', async () => {
			vi.mocked( trash ).mockRejectedValueOnce( new Error( 'File deletion failed' ) );

			await expect( runCommand( testSiteFolder, true ) ).resolves.not.toThrow();
			expect( saveCliConfig ).toHaveBeenCalled();
			expect( emitCliEvent ).toHaveBeenCalledWith(
				expect.objectContaining( { event: SITE_EVENTS.DELETED } )
			);
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should not remove domain or certificate if no custom domain', async () => {
			vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [] );

			await runCommand( testSiteFolder, false );

			expect( removeDomainFromHosts ).not.toHaveBeenCalled();
			expect( deleteSiteCertificate ).not.toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'records a site-delete Tracks event with delete_files true when trashing files', async () => {
			await runCommand( testSiteFolder, true );

			expect( recordTracksEvent ).toHaveBeenCalledWith(
				TRACKS_EVENTS.SITE_DELETE,
				expect.objectContaining( { delete_files: true } )
			);
		} );

		it( 'records a site-delete Tracks event with delete_files false when keeping files', async () => {
			await runCommand( testSiteFolder, false );

			expect( recordTracksEvent ).toHaveBeenCalledWith(
				TRACKS_EVENTS.SITE_DELETE,
				expect.objectContaining( { delete_files: false } )
			);
		} );
	} );

	describe( 'Batch deletion', () => {
		const createSites = ( count: number ): SiteData[] =>
			Array.from( { length: count }, ( _, index ) =>
				createTestSite( {
					id: `site-${ index + 1 }`,
					name: `Site ${ index + 1 }`,
					path: `/test/site/${ index + 1 }`,
					port: 8881 + index,
				} )
			);

		const mockSites = ( sites: SiteData[] ) => {
			vi.mocked( readCliConfig, { partial: true } ).mockResolvedValue( {
				version: 1,
				sites,
				snapshots: [],
			} );
		};

		it( 'deletes nine sites with a single daemon session', async () => {
			const sites = createSites( 9 );
			mockSites( sites );

			const result = await runDeleteCommand( {
				identities: sites.map( ( site ) => site.path ),
			} );

			expect( connectToDaemon ).toHaveBeenCalledTimes( 1 );
			expect( disconnectFromDaemon ).toHaveBeenCalledTimes( 1 );
			expect( saveCliConfig ).toHaveBeenCalledTimes( 9 );
			expect( trash ).toHaveBeenCalledTimes( 9 );
			expect( result.sites ).toHaveLength( 9 );
			expect( result.sites.every( ( site ) => site.status === 'deleted' ) ).toBe( true );
			expect( process.exitCode ).toBe( originalExitCode );
		} );

		it( 'resolves site IDs and paths in one invocation', async () => {
			const sites = createSites( 2 );
			mockSites( sites );

			const result = await runDeleteCommand( {
				identities: [ sites[ 0 ].id, sites[ 1 ].path ],
			} );

			expect( connectToDaemon ).toHaveBeenCalledTimes( 1 );
			expect( result.sites.map( ( site ) => site.id ) ).toEqual( [ 'site-1', 'site-2' ] );
			expect( result.sites.every( ( site ) => site.status === 'deleted' ) ).toBe( true );
		} );

		it( 'validates the full set before mutating and skips remaining sites', async () => {
			const sites = createSites( 2 );
			mockSites( sites );

			const result = await runDeleteCommand( {
				identities: [ sites[ 0 ].path, '/missing/site', sites[ 1 ].path ],
			} );

			expect( connectToDaemon ).not.toHaveBeenCalled();
			expect( saveCliConfig ).not.toHaveBeenCalled();
			expect( trash ).not.toHaveBeenCalled();
			expect( result.sites ).toEqual( [
				expect.objectContaining( {
					path: sites[ 0 ].path,
					status: 'skipped',
				} ),
				expect.objectContaining( {
					identity: '/missing/site',
					status: 'failed',
					error: 'The specified directory is not added to Studio.',
				} ),
				expect.objectContaining( {
					path: sites[ 1 ].path,
					status: 'skipped',
				} ),
			] );
			expect( process.exitCode ).toBe( 1 );
		} );

		it( 'rejects duplicate identities before mutating', async () => {
			mockSites( [ testSite ] );

			const result = await runDeleteCommand( {
				identities: [ testSite.path, testSite.id ],
			} );

			expect( connectToDaemon ).not.toHaveBeenCalled();
			expect( trash ).not.toHaveBeenCalled();
			expect( result.sites.map( ( site ) => site.status ) ).toEqual( [ 'skipped', 'failed' ] );
			expect( result.sites[ 1 ]?.error ).toBe( 'The same site was specified more than once.' );
			expect( process.exitCode ).toBe( 1 );
		} );

		it( 'continues after a per-site mutation failure and keeps completed evidence', async () => {
			const sites = createSites( 3 );
			mockSites( sites );
			vi.mocked( saveCliConfig )
				.mockResolvedValueOnce( undefined )
				.mockRejectedValueOnce( new Error( 'Config write failed' ) )
				.mockResolvedValueOnce( undefined );

			const result = await runDeleteCommand( {
				identities: sites.map( ( site ) => site.path ),
			} );

			expect( connectToDaemon ).toHaveBeenCalledTimes( 1 );
			expect( disconnectFromDaemon ).toHaveBeenCalledTimes( 1 );
			expect( saveCliConfig ).toHaveBeenCalledTimes( 3 );
			expect( result.sites.map( ( site ) => site.status ) ).toEqual( [
				'deleted',
				'failed',
				'deleted',
			] );
			expect( result.sites[ 1 ]?.error ).toBe( 'Config write failed' );
			expect( process.exitCode ).toBe( 1 );
		} );

		it( 'previews selected sites and file paths without starting the daemon', async () => {
			const sites = [
				createTestSite( {
					id: 'site-1',
					name: 'Site 1',
					path: '/test/site/1',
					technicalSiteDirectory: '/test/.studio/imports/1',
				} ),
				createTestSite( {
					id: 'site-2',
					name: 'Site 2',
					path: '/test/site/2',
				} ),
			];
			mockSites( sites );
			vi.spyOn( fs, 'existsSync' ).mockImplementation(
				( filePath ) =>
					filePath === '/test/site/1' ||
					filePath === '/test/.studio/imports/1' ||
					filePath === '/test/site/2'
			);

			const result = await runDeleteCommand( {
				identities: sites.map( ( site ) => site.path ),
				dryRun: true,
				format: 'json',
			} );

			expect( connectToDaemon ).not.toHaveBeenCalled();
			expect( saveCliConfig ).not.toHaveBeenCalled();
			expect( trash ).not.toHaveBeenCalled();
			expect( result ).toEqual( {
				dryRun: true,
				deleteFiles: true,
				sites: [
					{
						identity: '/test/site/1',
						status: 'selected',
						id: 'site-1',
						name: 'Site 1',
						path: '/test/site/1',
						filePaths: [ '/test/site/1', '/test/.studio/imports/1' ],
					},
					{
						identity: '/test/site/2',
						status: 'selected',
						id: 'site-2',
						name: 'Site 2',
						path: '/test/site/2',
						filePaths: [ '/test/site/2' ],
					},
				],
			} );
		} );

		it( 'emits machine-readable per-site outcomes', async () => {
			const sites = createSites( 2 );
			mockSites( sites );
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			const result = await runDeleteCommand( {
				identities: sites.map( ( site ) => site.path ),
				format: 'json',
			} );

			expect( result.sites.map( ( site ) => site.status ) ).toEqual( [ 'deleted', 'deleted' ] );
			expect( consoleSpy ).toHaveBeenCalledWith( JSON.stringify( result ) );
			consoleSpy.mockRestore();
		} );
	} );
} );
