/**
 * @vitest-environment node
 */
import { siteDetailsSchema } from '@studio/common/lib/cli-events';
import { authTokenSchema, sharedConfigSchema } from '@studio/common/lib/shared-config';
import { snapshotSchema } from '@studio/common/types/snapshot';
import { readFile, writeFile } from 'atomically';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { migrateAppdata } from 'src/migrations/migrate-appdata-via-cli';

const { mockFsExistsSync, mockFsMkdirSync } = vi.hoisted( () => ( {
	mockFsExistsSync: vi.fn(),
	mockFsMkdirSync: vi.fn(),
} ) );

vi.mock( 'fs', () => ( {
	default: {
		existsSync: mockFsExistsSync,
		mkdirSync: mockFsMkdirSync,
	},
	existsSync: mockFsExistsSync,
	mkdirSync: mockFsMkdirSync,
} ) );

vi.mock( 'atomically', () => ( {
	readFile: vi.fn(),
	writeFile: vi.fn(),
} ) );

vi.mock( 'src/lib/sanitize-for-logging', () => ( {
	sanitizeUserpath: ( p: string ) => p,
} ) );

// Validation schemas matching the actual config file schemas.
// shared.json schema
const sharedConfigValidationSchema = sharedConfigSchema;

// cli.json site schema (matches cli-config/core.ts siteSchema)
const cliSiteValidationSchema = siteDetailsSchema
	.extend( {
		url: z.string().optional(),
		latestCliPid: z.number().optional(),
	} )
	.loose();

const cliConfigValidationSchema = z.object( {
	version: z.literal( 1 ),
	sites: z.array( cliSiteValidationSchema ),
	snapshots: z.array( snapshotSchema ),
} );

// appdata.json schema — Desktop-only top-level fields + per-site Desktop fields
const appdataSiteValidationSchema = z
	.object( {
		id: z.string(),
		themeDetails: z
			.object( {
				name: z.string(),
				path: z.string(),
				slug: z.string(),
				isBlockTheme: z.boolean(),
				supportsWidgets: z.boolean(),
				supportsMenus: z.boolean(),
			} )
			.optional(),
		sortOrder: z.number().optional(),
	} )
	.strict();

const appdataValidationSchema = z
	.object( {
		version: z.literal( 1 ),
		sites: z.array( appdataSiteValidationSchema ).optional(),
		devToolsOpen: z.boolean().optional(),
		windowBounds: z
			.object( {
				x: z.number(),
				y: z.number(),
				width: z.number(),
				height: z.number(),
				isFullScreen: z.boolean().optional(),
			} )
			.optional(),
		onboardingCompleted: z.boolean().optional(),
		lastBumpStats: z.record( z.string(), z.unknown() ).optional(),
		promptWindowsSpeedUpResult: z
			.object( {
				response: z.enum( [ 'yes', 'no' ] ),
				appVersion: z.string(),
				dontAskAgain: z.boolean(),
			} )
			.optional(),
		connectedWpcomSites: z.record( z.string(), z.unknown() ).optional(),
		sentryUserId: z.string().optional(),
		lastSeenVersion: z.string().optional(),
		preferredTerminal: z.string().optional(),
		preferredEditor: z.string().optional(),
		betaFeatures: z.unknown().optional(),
		stopSitesOnQuit: z.boolean().optional(),
	} )
	.strict();

/**
 * A realistic old appdata-v1.json with all fields populated.
 */
function createOldAppdata() {
	return {
		version: 1,
		// Fields → shared.json
		authToken: {
			accessToken: 'test-token-123',
			expiresIn: 1209600,
			expirationTime: 1900000000000,
			id: 42,
			email: 'test@example.com',
			displayName: 'Test User',
		},
		locale: 'pt-br',
		// Fields → cli.json
		sites: [
			{
				id: 'site-1',
				name: 'My Site',
				path: '/home/user/Studio/my-site',
				port: 8881,
				phpVersion: '8.2',
				customDomain: 'mysite.local',
				enableHttps: true,
				adminUsername: 'admin',
				adminPassword: 'password',
				adminEmail: 'admin@example.com',
				isWpAutoUpdating: false,
				autoStart: true,
				latestCliPid: 12345,
				enableXdebug: false,
				enableDebugLog: true,
				enableDebugDisplay: false,
				// Fields → appdata.json (Desktop-only per-site)
				themeDetails: {
					name: 'Twenty Twenty-Four',
					path: '/themes/twentytwentyfour',
					slug: 'twentytwentyfour',
					isBlockTheme: true,
					supportsWidgets: false,
					supportsMenus: false,
				},
				sortOrder: 0,
				// Runtime field that should be stripped
				running: false,
			},
			{
				id: 'site-2',
				name: 'Another Site',
				path: '/home/user/Studio/another-site',
				port: 8882,
				phpVersion: '8.1',
				themeDetails: {
					name: 'Starter Theme',
					path: '/themes/starter',
					slug: 'starter',
					isBlockTheme: false,
					supportsWidgets: true,
					supportsMenus: true,
				},
				sortOrder: 1,
				running: true,
			},
		],
		snapshots: [
			{
				url: 'https://preview.wp.com/snap1',
				atomicSiteId: 100,
				localSiteId: 'site-1',
				date: 1710000000000,
				name: 'Snapshot 1',
				userId: 42,
			},
		],
		// Fields → appdata.json (Desktop-only top-level)
		devToolsOpen: true,
		windowBounds: { x: 100, y: 200, width: 1200, height: 800 },
		onboardingCompleted: true,
		lastBumpStats: { 'studio-app-launch': { mac_arm64: 5 } },
		promptWindowsSpeedUpResult: {
			response: 'no' as const,
			appVersion: '1.7.0',
			dontAskAgain: true,
		},
		connectedWpcomSites: { 42: [ { id: 1, name: 'Remote Site', url: 'https://remote.wp.com' } ] },
		sentryUserId: 'sentry-uuid-123',
		lastSeenVersion: '1.7.0',
		preferredTerminal: 'iterm',
		preferredEditor: 'vscode',
		betaFeatures: { ai: true },
		stopSitesOnQuit: false,
	};
}

/**
 * Returns the written JSON for a given file path from writeFile mock calls.
 */
function getWrittenJson( filePath: string ): Record< string, unknown > | undefined {
	const mockedWriteFile = vi.mocked( writeFile );
	const call = mockedWriteFile.mock.calls.find( ( [ path ] ) =>
		( path as string ).endsWith( filePath )
	);
	if ( ! call ) {
		return undefined;
	}
	return JSON.parse( call[ 1 ] as string );
}

describe( 'migrateAppdata', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		// By default: no new files exist, old file exists
		mockFsExistsSync.mockImplementation( ( p: string ) => {
			if ( p.includes( 'appdata-v1.json' ) ) {
				return true;
			}
			return false;
		} );
		vi.mocked( readFile ).mockResolvedValue( JSON.stringify( createOldAppdata() ) );
	} );

	it( 'skips migration if new appdata.json already exists', async () => {
		mockFsExistsSync.mockImplementation( ( p: string ) => {
			if ( p.endsWith( 'appdata.json' ) && p.includes( '.studio' ) ) {
				return true;
			}
			return false;
		} );

		await migrateAppdata();

		expect( readFile ).not.toHaveBeenCalled();
		expect( writeFile ).not.toHaveBeenCalled();
	} );

	it( 'skips migration if old appdata-v1.json does not exist', async () => {
		mockFsExistsSync.mockReturnValue( false );

		await migrateAppdata();

		expect( readFile ).not.toHaveBeenCalled();
		expect( writeFile ).not.toHaveBeenCalled();
	} );

	it( 'skips migration if old appdata is not valid JSON', async () => {
		vi.mocked( readFile ).mockResolvedValue( 'not valid json {{{' );
		const consoleSpy = vi.spyOn( console, 'error' ).mockImplementation( () => {} );

		await migrateAppdata();

		expect( writeFile ).not.toHaveBeenCalled();
		expect( consoleSpy ).toHaveBeenCalledWith(
			expect.stringContaining( 'Failed to parse old appdata' )
		);
		consoleSpy.mockRestore();
	} );

	it( 'writes three config files from old appdata', async () => {
		await migrateAppdata();

		expect( writeFile ).toHaveBeenCalledTimes( 3 );
	} );

	describe( 'shared.json', () => {
		it( 'contains auth token and locale matching the shared config schema', async () => {
			await migrateAppdata();

			const shared = getWrittenJson( 'shared.json' );
			expect( shared ).toBeDefined();

			// Validate against the real shared config schema
			const result = sharedConfigValidationSchema.safeParse( shared );
			expect( result.success ).toBe( true );
		} );

		it( 'preserves the auth token data', async () => {
			await migrateAppdata();

			const shared = getWrittenJson( 'shared.json' );
			const oldData = createOldAppdata();

			// Validate the token matches the authTokenSchema
			const tokenResult = authTokenSchema.safeParse( shared?.authToken );
			expect( tokenResult.success ).toBe( true );
			expect( shared?.authToken ).toEqual( oldData.authToken );
			expect( shared?.locale ).toBe( 'pt-br' );
		} );

		it( 'handles missing auth token and locale gracefully', async () => {
			const oldData = createOldAppdata();

			const { authToken, locale, ...rest } = oldData;
			vi.mocked( readFile ).mockResolvedValue( JSON.stringify( rest ) );

			await migrateAppdata();

			const shared = getWrittenJson( 'shared.json' );
			expect( shared ).toEqual( { version: 1 } );
			expect( sharedConfigValidationSchema.safeParse( shared ).success ).toBe( true );
		} );

		it( 'does not include non-shared fields', async () => {
			await migrateAppdata();

			const shared = getWrittenJson( 'shared.json' );
			expect( shared ).not.toHaveProperty( 'sites' );
			expect( shared ).not.toHaveProperty( 'snapshots' );
			expect( shared ).not.toHaveProperty( 'devToolsOpen' );
			expect( shared ).not.toHaveProperty( 'windowBounds' );
		} );
	} );

	describe( 'cli.json', () => {
		it( 'contains sites and snapshots matching the CLI config schema', async () => {
			await migrateAppdata();

			const cli = getWrittenJson( 'cli.json' );
			expect( cli ).toBeDefined();

			const result = cliConfigValidationSchema.safeParse( cli );
			expect( result.success ).toBe( true );
		} );

		it( 'includes only CLI-relevant site fields', async () => {
			await migrateAppdata();

			const cli = getWrittenJson( 'cli.json' );
			const sites = cli?.sites as Record< string, unknown >[];

			expect( sites ).toHaveLength( 2 );

			// Should have CLI fields
			expect( sites[ 0 ] ).toHaveProperty( 'id', 'site-1' );
			expect( sites[ 0 ] ).toHaveProperty( 'name', 'My Site' );
			expect( sites[ 0 ] ).toHaveProperty( 'port', 8881 );
			expect( sites[ 0 ] ).toHaveProperty( 'customDomain', 'mysite.local' );
			expect( sites[ 0 ] ).toHaveProperty( 'enableHttps', true );
			expect( sites[ 0 ] ).toHaveProperty( 'latestCliPid', 12345 );

			// Should NOT have Desktop-only fields
			expect( sites[ 0 ] ).not.toHaveProperty( 'themeDetails' );
			expect( sites[ 0 ] ).not.toHaveProperty( 'sortOrder' );
			expect( sites[ 0 ] ).not.toHaveProperty( 'running' );
		} );

		it( 'preserves snapshots as-is', async () => {
			await migrateAppdata();

			const cli = getWrittenJson( 'cli.json' );
			const oldData = createOldAppdata();

			expect( cli?.snapshots ).toEqual( oldData.snapshots );

			// Validate each snapshot against the schema
			const snapshots = cli?.snapshots as unknown[];
			for ( const snapshot of snapshots ) {
				expect( snapshotSchema.safeParse( snapshot ).success ).toBe( true );
			}
		} );

		it( 'handles empty sites and snapshots', async () => {
			const oldData = createOldAppdata();
			vi.mocked( readFile ).mockResolvedValue(
				JSON.stringify( { ...oldData, sites: [], snapshots: [] } )
			);

			await migrateAppdata();

			const cli = getWrittenJson( 'cli.json' );
			expect( cli?.sites ).toEqual( [] );
			expect( cli?.snapshots ).toEqual( [] );
			expect( cliConfigValidationSchema.safeParse( cli ).success ).toBe( true );
		} );

		it( 'handles missing sites and snapshots arrays', async () => {
			const oldData = createOldAppdata();

			const { sites, snapshots, ...rest } = oldData;
			vi.mocked( readFile ).mockResolvedValue( JSON.stringify( rest ) );

			await migrateAppdata();

			const cli = getWrittenJson( 'cli.json' );
			expect( cli?.sites ).toEqual( [] );
			expect( cli?.snapshots ).toEqual( [] );
			expect( cliConfigValidationSchema.safeParse( cli ).success ).toBe( true );
		} );
	} );

	describe( 'appdata.json', () => {
		it( 'contains Desktop-only fields matching the appdata schema', async () => {
			await migrateAppdata();

			const appdata = getWrittenJson( 'appdata.json' );
			expect( appdata ).toBeDefined();

			const result = appdataValidationSchema.safeParse( appdata );
			expect( result.success ).toBe( true );
		} );

		it( 'preserves all Desktop-only top-level fields', async () => {
			await migrateAppdata();

			const appdata = getWrittenJson( 'appdata.json' );
			const oldData = createOldAppdata();

			expect( appdata?.devToolsOpen ).toBe( oldData.devToolsOpen );
			expect( appdata?.windowBounds ).toEqual( oldData.windowBounds );
			expect( appdata?.onboardingCompleted ).toBe( oldData.onboardingCompleted );
			expect( appdata?.lastBumpStats ).toEqual( oldData.lastBumpStats );
			expect( appdata?.promptWindowsSpeedUpResult ).toEqual( oldData.promptWindowsSpeedUpResult );
			expect( appdata?.connectedWpcomSites ).toEqual( oldData.connectedWpcomSites );
			expect( appdata?.sentryUserId ).toBe( oldData.sentryUserId );
			expect( appdata?.lastSeenVersion ).toBe( oldData.lastSeenVersion );
			expect( appdata?.preferredTerminal ).toBe( oldData.preferredTerminal );
			expect( appdata?.preferredEditor ).toBe( oldData.preferredEditor );
			expect( appdata?.betaFeatures ).toEqual( oldData.betaFeatures );
			expect( appdata?.stopSitesOnQuit ).toBe( oldData.stopSitesOnQuit );
		} );

		it( 'does not include fields that moved to shared.json or cli.json', async () => {
			await migrateAppdata();

			const appdata = getWrittenJson( 'appdata.json' );

			expect( appdata ).not.toHaveProperty( 'authToken' );
			expect( appdata ).not.toHaveProperty( 'locale' );
			expect( appdata ).not.toHaveProperty( 'snapshots' );
		} );

		it( 'keeps per-site Desktop fields (themeDetails, sortOrder) with id', async () => {
			await migrateAppdata();

			const appdata = getWrittenJson( 'appdata.json' );
			const sites = appdata?.sites as Record< string, unknown >[];
			const oldData = createOldAppdata();

			expect( sites ).toHaveLength( 2 );

			// Should have Desktop-only fields
			expect( sites[ 0 ] ).toEqual( {
				id: 'site-1',
				themeDetails: oldData.sites[ 0 ].themeDetails,
				sortOrder: 0,
			} );

			// Should NOT have CLI fields
			expect( sites[ 0 ] ).not.toHaveProperty( 'name' );
			expect( sites[ 0 ] ).not.toHaveProperty( 'path' );
			expect( sites[ 0 ] ).not.toHaveProperty( 'port' );
			expect( sites[ 0 ] ).not.toHaveProperty( 'running' );
		} );

		it( 'omits sites array when no sites have Desktop-specific data', async () => {
			const oldData = createOldAppdata();
			const sitesWithoutDesktopFields = oldData.sites.map(
				( { themeDetails, sortOrder, ...rest } ) => rest
			);
			vi.mocked( readFile ).mockResolvedValue(
				JSON.stringify( { ...oldData, sites: sitesWithoutDesktopFields } )
			);

			await migrateAppdata();

			const appdata = getWrittenJson( 'appdata.json' );
			expect( appdata ).not.toHaveProperty( 'sites' );
			expect( appdataValidationSchema.safeParse( appdata ).success ).toBe( true );
		} );
	} );

	describe( 'partial migration recovery', () => {
		it( 'does not overwrite shared.json if it already exists', async () => {
			mockFsExistsSync.mockImplementation( ( p: string ) => {
				if ( p.includes( 'appdata-v1.json' ) ) {
					return true;
				}
				if ( p.endsWith( 'shared.json' ) ) {
					return true;
				}
				return false;
			} );

			await migrateAppdata();

			// Should write cli.json and appdata.json but not shared.json
			expect( writeFile ).toHaveBeenCalledTimes( 2 );
			const writtenPaths = vi.mocked( writeFile ).mock.calls.map( ( [ p ] ) => p as string );
			expect( writtenPaths.some( ( p ) => p.endsWith( 'shared.json' ) ) ).toBe( false );
			expect( writtenPaths.some( ( p ) => p.endsWith( 'cli.json' ) ) ).toBe( true );
			expect( writtenPaths.some( ( p ) => p.endsWith( 'appdata.json' ) ) ).toBe( true );
		} );

		it( 'does not overwrite cli.json if it already exists', async () => {
			mockFsExistsSync.mockImplementation( ( p: string ) => {
				if ( p.includes( 'appdata-v1.json' ) ) {
					return true;
				}
				if ( p.endsWith( 'cli.json' ) ) {
					return true;
				}
				return false;
			} );

			await migrateAppdata();

			// Should write shared.json and appdata.json but not cli.json
			expect( writeFile ).toHaveBeenCalledTimes( 2 );
			const writtenPaths = vi.mocked( writeFile ).mock.calls.map( ( [ p ] ) => p as string );
			expect( writtenPaths.some( ( p ) => p.endsWith( 'cli.json' ) ) ).toBe( false );
			expect( writtenPaths.some( ( p ) => p.endsWith( 'shared.json' ) ) ).toBe( true );
			expect( writtenPaths.some( ( p ) => p.endsWith( 'appdata.json' ) ) ).toBe( true );
		} );
	} );

	describe( 'minimal old appdata', () => {
		it( 'handles an old appdata with only version field', async () => {
			vi.mocked( readFile ).mockResolvedValue( JSON.stringify( { version: 1 } ) );

			await migrateAppdata();

			const shared = getWrittenJson( 'shared.json' );
			expect( shared ).toEqual( { version: 1 } );
			expect( sharedConfigValidationSchema.safeParse( shared ).success ).toBe( true );

			const cli = getWrittenJson( 'cli.json' );
			expect( cli ).toEqual( { version: 1, sites: [], snapshots: [] } );
			expect( cliConfigValidationSchema.safeParse( cli ).success ).toBe( true );

			const appdata = getWrittenJson( 'appdata.json' );
			expect( appdata ).toEqual( { version: 1 } );
			expect( appdataValidationSchema.safeParse( appdata ).success ).toBe( true );
		} );
	} );
} );
