import { readAuthToken } from '@studio/common/lib/shared-config';
import { vi } from 'vitest';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import {
	getSnapshotsFromConfig,
	isSnapshotExpired,
	pruneExpiredOrphanedSnapshots,
} from 'cli/lib/snapshots';
import {
	mockReportStart,
	mockReportSuccess,
	mockReportError,
	mockReportProgress,
	mockReportWarning,
	mockReportKeyValuePair,
} from 'cli/tests/test-utils';
import { runCommand } from '../list';

vi.mock( import( '@studio/common/lib/shared-config' ), async ( importOriginal ) => ( {
	...( await importOriginal() ),
	readAuthToken: vi.fn(),
} ) );
vi.mock( 'cli/lib/cli-config/core', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config/core' );
	return {
		...actual,
		readCliConfig: vi.fn(),
	};
} );
vi.mock( 'cli/lib/cli-config/sites', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config/sites' );
	return {
		...actual,
		getSiteByFolder: vi.fn(),
	};
} );
vi.mock( 'cli/lib/snapshots' );
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

describe( 'Preview List Command', () => {
	const mockFolder = '/test/folder';
	const mockAuthToken = {
		accessToken: 'mock-auth-token',
		id: 123,
		email: 'test@example.com',
		displayName: 'Test User',
		expiresIn: 1209600,
		expirationTime: Date.now() + 1209600000,
	};
	const mockSite = {
		id: 'site-1',
		path: mockFolder,
		name: 'Test Site',
		phpVersion: '8.0',
		port: 8888,
		running: false,
	};
	const mockSnapshots = [
		{
			url: 'test1.example.com',
			atomicSiteId: 123,
			localSiteId: '456',
			date: Date.now(),
			name: 'Test Snapshot 1',
			userId: 789,
		},
		{
			url: 'test2.example.com',
			atomicSiteId: 124,
			localSiteId: '457',
			date: Date.now(),
			name: 'Test Snapshot 2',
			userId: 789,
		},
	];

	beforeEach( () => {
		vi.clearAllMocks();
		vi.spyOn( process, 'cwd' ).mockReturnValue( mockFolder );

		vi.mocked( getSiteByFolder ).mockResolvedValue( mockSite );
		vi.mocked( readAuthToken ).mockResolvedValue( mockAuthToken );
		vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( mockSnapshots );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should list preview sites successfully', async () => {
		await runCommand( mockFolder, 'table' );

		expect( getSnapshotsFromConfig ).toHaveBeenCalledWith( mockAuthToken.id, mockFolder );
		expect( mockReportStart.mock.calls[ 0 ] ).toEqual( [ 'validate', 'Validating…' ] );
		expect( mockReportStart.mock.calls[ 1 ] ).toEqual( [ 'load', 'Loading preview sites…' ] );
		expect( mockReportSuccess.mock.calls[ 0 ] ).toEqual( [ 'Found 2 preview sites' ] );
	} );

	it( 'should render the single-site table without grouped headers', async () => {
		const consoleLogSpy = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );

		await runCommand( mockFolder, 'table' );

		const loggedLines = consoleLogSpy.mock.calls.map( ( call: unknown[] ) => String( call[ 0 ] ) );
		// No grouped "Site Name (N preview site[s])" header in the single-site path.
		expect( loggedLines.some( ( line ) => /\(\d+ preview sites?\)/.test( line ) ) ).toBe( false );
		// The snapshot table should be rendered once.
		expect( loggedLines ).toHaveLength( 1 );
		expect( loggedLines[ 0 ] ).toContain( mockSnapshots[ 0 ].name );
		expect( loggedLines[ 0 ] ).toContain( mockSnapshots[ 1 ].name );
	} );

	it( 'should handle validation errors', async () => {
		vi.mocked( readAuthToken ).mockResolvedValue( null );

		await runCommand( mockFolder, 'table' );

		expect( mockReportError ).toHaveBeenCalled();
	} );

	it( 'should handle no snapshots found', async () => {
		vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [] );

		await runCommand( mockFolder, 'table' );

		expect( mockReportStart.mock.calls[ 0 ] ).toEqual( [ 'validate', 'Validating…' ] );
		expect( mockReportStart.mock.calls[ 1 ] ).toEqual( [ 'load', 'Loading preview sites…' ] );
		expect( mockReportSuccess.mock.calls[ 0 ] ).toEqual( [ 'No preview sites found' ] );
	} );

	describe( 'with --all flag', () => {
		// mockSites[0].id ('456') matches mockSnapshots[0].localSiteId,
		// mockSites[1].id ('457') matches mockSnapshots[1].localSiteId — that linkage
		// is what drives the grouping logic exercised by these tests.
		const mockSites = [
			{
				id: '456',
				path: '/test/folder-a',
				name: 'Site A',
				phpVersion: '8.0',
				port: 8888,
				running: false,
			},
			{
				id: '457',
				path: '/test/folder-b',
				name: 'Site B',
				phpVersion: '8.0',
				port: 8889,
				running: false,
			},
		];
		let consoleLogSpy: ReturnType< typeof vi.spyOn >;

		beforeEach( () => {
			vi.mocked( readCliConfig ).mockResolvedValue( {
				version: 1,
				sites: mockSites,
				snapshots: mockSnapshots,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any );
			consoleLogSpy = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		} );

		it( 'should list all preview sites across local sites without requiring a valid site folder', async () => {
			await runCommand( '/not/a/site', 'table', true );

			expect( getSiteByFolder ).not.toHaveBeenCalled();
			expect( getSnapshotsFromConfig ).toHaveBeenCalledWith( mockAuthToken.id, undefined );
			expect( mockReportSuccess.mock.calls[ 0 ] ).toEqual( [ 'Found 2 preview sites' ] );
			expect( mockReportError ).not.toHaveBeenCalled();
		} );

		it( 'should print one grouped header per local site with a per-site count', async () => {
			await runCommand( '/not/a/site', 'table', true );

			const output = consoleLogSpy.mock.calls
				.map( ( call: unknown[] ) => String( call[ 0 ] ) )
				.join( '\n' );
			expect( output ).toMatch( /^Site A — \/test\/folder-a \(\d+ preview sites?\)$/m );
			expect( output ).toMatch( /^Site B — \/test\/folder-b \(\d+ preview sites?\)$/m );
		} );

		it( 'should not merge two local sites that happen to share the same name', async () => {
			// Studio doesn't enforce site-name uniqueness, so grouping must be by id.
			vi.mocked( readCliConfig ).mockResolvedValue( {
				version: 1,
				sites: [
					{ ...mockSites[ 0 ], id: 'dup-1', name: 'Duplicate', path: '/dup/one' },
					{ ...mockSites[ 1 ], id: 'dup-2', name: 'Duplicate', path: '/dup/two' },
				],
				snapshots: [],
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any );
			vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [
				{
					url: 'dup-1.example.com',
					atomicSiteId: 1,
					localSiteId: 'dup-1',
					date: Date.now(),
					name: 'Dup 1 snapshot',
					userId: 789,
				},
				{
					url: 'dup-2.example.com',
					atomicSiteId: 2,
					localSiteId: 'dup-2',
					date: Date.now(),
					name: 'Dup 2 snapshot',
					userId: 789,
				},
			] );

			await runCommand( '/not/a/site', 'table', true );

			const output = consoleLogSpy.mock.calls
				.map( ( call: unknown[] ) => String( call[ 0 ] ) )
				.join( '\n' );
			const duplicateHeaders =
				output.match( /^Duplicate — \/dup\/\w+ \(\d+ preview sites?\)$/gm ) ?? [];
			// Two separate groups, disambiguated by path, each with 1 snapshot.
			expect( duplicateHeaders.sort() ).toEqual( [
				'Duplicate — /dup/one (1 preview site)',
				'Duplicate — /dup/two (1 preview site)',
			] );
		} );

		it( 'should order groups by preview-site count descending, tie-breaking alphabetically', async () => {
			vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [
				// Site A gets 1 snapshot, Site B gets 2. B should appear first.
				{
					url: 'a1.example.com',
					atomicSiteId: 1,
					localSiteId: '456',
					date: Date.now(),
					name: 'A1',
					userId: 789,
				},
				{
					url: 'b1.example.com',
					atomicSiteId: 2,
					localSiteId: '457',
					date: Date.now(),
					name: 'B1',
					userId: 789,
				},
				{
					url: 'b2.example.com',
					atomicSiteId: 3,
					localSiteId: '457',
					date: Date.now(),
					name: 'B2',
					userId: 789,
				},
			] );

			await runCommand( '/not/a/site', 'table', true );

			const output = consoleLogSpy.mock.calls
				.map( ( call: unknown[] ) => String( call[ 0 ] ) )
				.join( '\n' );
			const siteAIndex = output.indexOf( 'Site A —' );
			const siteBIndex = output.indexOf( 'Site B —' );
			expect( siteBIndex ).toBeGreaterThanOrEqual( 0 );
			expect( siteAIndex ).toBeGreaterThan( siteBIndex );
		} );

		it( 'should fall back to "Unknown site" for orphaned snapshots', async () => {
			vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [
				{
					url: 'orphan.example.com',
					atomicSiteId: 999,
					localSiteId: 'no-such-site',
					date: Date.now(),
					name: 'Orphan Snapshot',
					userId: 789,
				},
			] );

			await runCommand( '/not/a/site', 'table', true );

			const output = consoleLogSpy.mock.calls
				.map( ( call: unknown[] ) => String( call[ 0 ] ) )
				.join( '\n' );
			expect( output ).toMatch( /^Unknown site \(1 preview site\)$/m );
			expect( mockReportError ).not.toHaveBeenCalled();
		} );

		it( 'should coalesce orphaned snapshots from multiple dead sites into a single "Unknown site" group', async () => {
			vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [
				{
					url: 'orphan1.example.com',
					atomicSiteId: 998,
					localSiteId: 'dead-site-a',
					date: Date.now(),
					name: 'Orphan 1',
					userId: 789,
				},
				{
					url: 'orphan2.example.com',
					atomicSiteId: 999,
					localSiteId: 'dead-site-b',
					date: Date.now(),
					name: 'Orphan 2',
					userId: 789,
				},
			] );

			await runCommand( '/not/a/site', 'table', true );

			const output = consoleLogSpy.mock.calls
				.map( ( call: unknown[] ) => String( call[ 0 ] ) )
				.join( '\n' );
			const unknownHeaders = output.match( /^Unknown site \(\d+ preview sites?\)$/gm ) ?? [];
			expect( unknownHeaders ).toEqual( [ 'Unknown site (2 preview sites)' ] );
		} );

		it( 'should include the expired badge in the summary when snapshots are expired', async () => {
			const expiredSnapshot = {
				url: 'expired.example.com',
				atomicSiteId: 111,
				localSiteId: '456',
				date: Date.now() - 1000 * 60 * 60 * 24 * 60, // 60 days ago
				name: 'Expired Snapshot',
				userId: 789,
			};
			vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [
				expiredSnapshot,
				mockSnapshots[ 0 ],
			] );
			vi.mocked( isSnapshotExpired ).mockImplementation(
				( snapshot ) => snapshot.url === expiredSnapshot.url
			);

			await runCommand( '/not/a/site', 'table', true );

			expect( mockReportSuccess.mock.calls[ 0 ] ).toEqual( [
				'Found 2 preview sites (1 expired)',
			] );
		} );

		it( 'should report no preview sites when config is empty', async () => {
			vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [] );

			await runCommand( '/not/a/site', 'table', true );

			expect( mockReportSuccess.mock.calls[ 0 ] ).toEqual( [ 'No preview sites found' ] );
		} );

		it( 'should prune expired orphaned snapshots from cli.json before listing', async () => {
			await runCommand( '/not/a/site', 'table', true );

			expect( pruneExpiredOrphanedSnapshots ).toHaveBeenCalledWith(
				mockAuthToken.id,
				isSnapshotExpired
			);
			// Prune must run before the snapshot fetch so the command sees the cleaned list.
			const pruneOrder =
				vi.mocked( pruneExpiredOrphanedSnapshots ).mock.invocationCallOrder[ 0 ] ?? Infinity;
			const fetchOrder =
				vi.mocked( getSnapshotsFromConfig ).mock.invocationCallOrder[ 0 ] ?? -Infinity;
			expect( pruneOrder ).toBeLessThan( fetchOrder );
		} );
	} );

	it( 'should prune expired orphaned snapshots even when running without --all', async () => {
		await runCommand( mockFolder, 'table' );

		expect( pruneExpiredOrphanedSnapshots ).toHaveBeenCalledWith(
			mockAuthToken.id,
			isSnapshotExpired
		);
	} );
} );
