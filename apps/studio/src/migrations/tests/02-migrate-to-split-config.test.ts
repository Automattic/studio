/**
 * @vitest-environment node
 */
import { existsSync } from 'fs';
import { siteDetailsSchema } from '@studio/common/lib/cli-events';
import { authTokenSchema, sharedConfigSchema } from '@studio/common/lib/shared-config';
import { snapshotSchema } from '@studio/common/types/snapshot';
import { readFile, writeFile } from 'atomically';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { migrateAppConfig } from 'src/migrations/02-migrate-to-split-config';

async function runMigration() {
	if ( await migrateAppConfig.needsToRun() ) {
		await migrateAppConfig.run();
	}
}

vi.mock( 'fs' );

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

// app.json schema — Desktop-only top-level fields + per-site Desktop fields (keyed by id)
const appSiteValidationSchema = z
	.object( {
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

const appConfigValidationSchema = z
	.object( {
		version: z.literal( 1 ),
		siteMetadata: z.record( z.string(), appSiteValidationSchema ).optional(),
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
				// Fields → app.json (Desktop-only per-site)
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
		// Fields → cli.json (AI config)
		aiProvider: 'anthropic',
		anthropicApiKey: 'sk-ant-test-key-123',
		// Fields → app.json (Desktop-only top-level)
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

describe( 'migrateAppConfig', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		// By default: no new files exist, old file exists
		vi.mocked( existsSync ).mockImplementation( ( p ) => {
			if ( typeof p === 'string' && p.includes( 'appdata-v1.json' ) ) {
				return true;
			}
			return false;
		} );
		vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( createOldAppdata() ) ) );
	} );

	it( 'does not need to run if new app.json already exists', async () => {
		vi.mocked( existsSync ).mockImplementation( ( p ) => {
			if ( typeof p === 'string' && p.endsWith( 'app.json' ) && p.includes( '.studio' ) ) {
				return true;
			}
			return false;
		} );

		expect( await migrateAppConfig.needsToRun() ).toBe( false );
	} );

	it( 'does not need to run if old appdata-v1.json does not exist', async () => {
		vi.mocked( existsSync ).mockReturnValue( false );

		expect( await migrateAppConfig.needsToRun() ).toBe( false );
	} );

	it( 'throws when old appdata is not valid JSON', async () => {
		vi.mocked( readFile ).mockResolvedValue( Buffer.from( 'not valid json {{{' ) );

		expect( await migrateAppConfig.needsToRun() ).toBe( true );
		await expect( migrateAppConfig.run() ).rejects.toThrow( SyntaxError );

		expect( writeFile ).not.toHaveBeenCalled();
	} );

	it( 'writes three config files from old appdata', async () => {
		await runMigration();

		expect( writeFile ).toHaveBeenCalledTimes( 3 );
	} );

	describe( 'shared.json', () => {
		it( 'contains auth token and locale matching the shared config schema', async () => {
			await runMigration();

			const shared = getWrittenJson( 'shared.json' );
			expect( shared ).toBeDefined();

			// Validate against the real shared config schema
			const result = sharedConfigValidationSchema.safeParse( shared );
			expect( result.success ).toBe( true );
		} );

		it( 'preserves the auth token data', async () => {
			await runMigration();

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
			vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( rest ) ) );

			await runMigration();

			const shared = getWrittenJson( 'shared.json' );
			expect( shared ).toEqual( { version: 1 } );
			expect( sharedConfigValidationSchema.safeParse( shared ).success ).toBe( true );
		} );

		it( 'does not include non-shared fields', async () => {
			await runMigration();

			const shared = getWrittenJson( 'shared.json' );
			expect( shared ).not.toHaveProperty( 'sites' );
			expect( shared ).not.toHaveProperty( 'snapshots' );
			expect( shared ).not.toHaveProperty( 'devToolsOpen' );
			expect( shared ).not.toHaveProperty( 'windowBounds' );
		} );
	} );

	describe( 'cli.json', () => {
		it( 'contains sites and snapshots matching the CLI config schema', async () => {
			await runMigration();

			const cli = getWrittenJson( 'cli.json' );
			expect( cli ).toBeDefined();

			const result = cliConfigValidationSchema.safeParse( cli );
			expect( result.success ).toBe( true );
		} );

		it( 'includes only CLI-relevant site fields', async () => {
			await runMigration();

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
			await runMigration();

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
				Buffer.from( JSON.stringify( { ...oldData, sites: [], snapshots: [] } ) )
			);

			await runMigration();

			const cli = getWrittenJson( 'cli.json' );
			expect( cli?.sites ).toEqual( [] );
			expect( cli?.snapshots ).toEqual( [] );
			expect( cliConfigValidationSchema.safeParse( cli ).success ).toBe( true );
		} );

		it( 'handles missing sites and snapshots arrays', async () => {
			const oldData = createOldAppdata();

			const { sites, snapshots, ...rest } = oldData;
			vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( rest ) ) );

			await runMigration();

			const cli = getWrittenJson( 'cli.json' );
			expect( cli?.sites ).toEqual( [] );
			expect( cli?.snapshots ).toEqual( [] );
			expect( cliConfigValidationSchema.safeParse( cli ).success ).toBe( true );
		} );
	} );

	describe( 'app.json', () => {
		it( 'contains Desktop-only fields matching the app config schema', async () => {
			await runMigration();

			const appConfig = getWrittenJson( 'app.json' );
			expect( appConfig ).toBeDefined();

			const result = appConfigValidationSchema.safeParse( appConfig );
			expect( result.success ).toBe( true );
		} );

		it( 'preserves all Desktop-only top-level fields', async () => {
			await runMigration();

			const appConfig = getWrittenJson( 'app.json' );
			const oldData = createOldAppdata();

			expect( appConfig?.devToolsOpen ).toBe( oldData.devToolsOpen );
			expect( appConfig?.windowBounds ).toEqual( oldData.windowBounds );
			expect( appConfig?.onboardingCompleted ).toBe( oldData.onboardingCompleted );
			expect( appConfig?.lastBumpStats ).toEqual( oldData.lastBumpStats );
			expect( appConfig?.promptWindowsSpeedUpResult ).toEqual( oldData.promptWindowsSpeedUpResult );
			expect( appConfig?.connectedWpcomSites ).toEqual( oldData.connectedWpcomSites );
			expect( appConfig?.sentryUserId ).toBe( oldData.sentryUserId );
			expect( appConfig?.lastSeenVersion ).toBe( oldData.lastSeenVersion );
			expect( appConfig?.preferredTerminal ).toBe( oldData.preferredTerminal );
			expect( appConfig?.preferredEditor ).toBe( oldData.preferredEditor );
			expect( appConfig?.betaFeatures ).toEqual( oldData.betaFeatures );
			expect( appConfig?.stopSitesOnQuit ).toBe( oldData.stopSitesOnQuit );
		} );

		it( 'does not include fields that moved to shared.json or cli.json', async () => {
			await runMigration();

			const appConfig = getWrittenJson( 'app.json' );

			expect( appConfig ).not.toHaveProperty( 'authToken' );
			expect( appConfig ).not.toHaveProperty( 'locale' );
			expect( appConfig ).not.toHaveProperty( 'snapshots' );
			expect( appConfig ).not.toHaveProperty( 'aiProvider' );
			expect( appConfig ).not.toHaveProperty( 'anthropicApiKey' );
		} );

		it( 'keeps per-site Desktop fields (themeDetails, sortOrder) keyed by id', async () => {
			await runMigration();

			const appConfig = getWrittenJson( 'app.json' );
			const sites = appConfig?.siteMetadata as Record< string, Record< string, unknown > >;
			const oldData = createOldAppdata();

			expect( Object.keys( sites ) ).toHaveLength( 2 );

			// Should have Desktop-only fields keyed by site id
			expect( sites[ 'site-1' ] ).toEqual( {
				themeDetails: oldData.sites[ 0 ].themeDetails,
				sortOrder: 0,
			} );

			// Should NOT have CLI fields
			expect( sites[ 'site-1' ] ).not.toHaveProperty( 'id' );
			expect( sites[ 'site-1' ] ).not.toHaveProperty( 'name' );
			expect( sites[ 'site-1' ] ).not.toHaveProperty( 'path' );
			expect( sites[ 'site-1' ] ).not.toHaveProperty( 'port' );
			expect( sites[ 'site-1' ] ).not.toHaveProperty( 'running' );
		} );

		it( 'omits sites array when no sites have Desktop-specific data', async () => {
			const oldData = createOldAppdata();
			const sitesWithoutDesktopFields = oldData.sites.map(
				( { themeDetails, sortOrder, ...rest } ) => rest
			);
			vi.mocked( readFile ).mockResolvedValue(
				Buffer.from( JSON.stringify( { ...oldData, sites: sitesWithoutDesktopFields } ) )
			);

			await runMigration();

			const appConfig = getWrittenJson( 'app.json' );
			expect( appConfig ).not.toHaveProperty( 'siteMetadata' );
			expect( appConfigValidationSchema.safeParse( appConfig ).success ).toBe( true );
		} );
	} );

	describe( 'partial migration recovery', () => {
		it( 'does not overwrite shared.json if it already exists', async () => {
			vi.mocked( existsSync ).mockImplementation( ( p ) => {
				if ( typeof p === 'string' && p.includes( 'appdata-v1.json' ) ) {
					return true;
				}
				if ( typeof p === 'string' && p.endsWith( 'shared.json' ) ) {
					return true;
				}
				return false;
			} );

			await runMigration();

			// Should write cli.json and app.json but not shared.json
			expect( writeFile ).toHaveBeenCalledTimes( 2 );
			const writtenPaths = vi.mocked( writeFile ).mock.calls.map( ( [ p ] ) => p as string );
			expect( writtenPaths.some( ( p ) => p.endsWith( 'shared.json' ) ) ).toBe( false );
			expect( writtenPaths.some( ( p ) => p.endsWith( 'cli.json' ) ) ).toBe( true );
			expect( writtenPaths.some( ( p ) => p.endsWith( 'app.json' ) ) ).toBe( true );
		} );

		it( 'does not overwrite cli.json if it already exists', async () => {
			vi.mocked( existsSync ).mockImplementation( ( p ) => {
				if ( typeof p === 'string' && p.includes( 'appdata-v1.json' ) ) {
					return true;
				}
				if ( typeof p === 'string' && p.endsWith( 'cli.json' ) ) {
					return true;
				}
				return false;
			} );

			await runMigration();

			// Should write shared.json and app.json but not cli.json
			expect( writeFile ).toHaveBeenCalledTimes( 2 );
			const writtenPaths = vi.mocked( writeFile ).mock.calls.map( ( [ p ] ) => p as string );
			expect( writtenPaths.some( ( p ) => p.endsWith( 'cli.json' ) ) ).toBe( false );
			expect( writtenPaths.some( ( p ) => p.endsWith( 'shared.json' ) ) ).toBe( true );
			expect( writtenPaths.some( ( p ) => p.endsWith( 'app.json' ) ) ).toBe( true );
		} );
	} );

	describe( 'minimal old appdata', () => {
		it( 'handles an old appdata with only version field', async () => {
			vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( { version: 1 } ) ) );

			await runMigration();

			const shared = getWrittenJson( 'shared.json' );
			expect( shared ).toEqual( { version: 1 } );
			expect( sharedConfigValidationSchema.safeParse( shared ).success ).toBe( true );

			const cli = getWrittenJson( 'cli.json' );
			expect( cli ).toEqual( { version: 1, sites: [], snapshots: [] } );
			expect( cliConfigValidationSchema.safeParse( cli ).success ).toBe( true );

			const appConfig = getWrittenJson( 'app.json' );
			expect( appConfig ).toEqual( { version: 1 } );
			expect( appConfigValidationSchema.safeParse( appConfig ).success ).toBe( true );
		} );
	} );
} );
