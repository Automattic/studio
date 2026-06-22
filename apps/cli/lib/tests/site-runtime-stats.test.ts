import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bumpStat } from 'cli/lib/bump-stat';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	SiteData,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { StatsGroup, StatsMetric } from 'cli/lib/types/bump-stats';
import { getSiteRuntimeStat, recordSiteRuntimeUsage } from '../site-runtime-stats';

vi.mock( 'cli/lib/bump-stat', () => ( { bumpStat: vi.fn() } ) );
vi.mock( 'cli/lib/cli-config/core', () => ( {
	lockCliConfig: vi.fn(),
	unlockCliConfig: vi.fn(),
	readCliConfig: vi.fn(),
	saveCliConfig: vi.fn(),
} ) );

const nativeAllFilesSite: SiteData = {
	id: 'site-1',
	name: 'My WordPress Site',
	path: '/home/user/Studio/my-wordpress-site',
	port: 8888,
	runtime: 'native-php',
	fileAccess: 'all-files',
	phpVersion: DEFAULT_PHP_VERSION,
} as const;

let mockConfig: Awaited< ReturnType< typeof readCliConfig > >;

beforeEach( () => {
	vi.stubGlobal( '__ENABLE_CLI_TELEMETRY__', true );
	mockConfig = { version: 1, sites: [], snapshots: [] };
	vi.mocked( lockCliConfig ).mockResolvedValue( undefined );
	vi.mocked( unlockCliConfig ).mockResolvedValue( undefined );
	vi.mocked( readCliConfig ).mockImplementation( async () => structuredClone( mockConfig ) );
	vi.mocked( saveCliConfig ).mockImplementation( async ( config ) => {
		mockConfig = structuredClone( config );
	} );
} );

afterEach( () => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
} );

describe( 'getSiteRuntimeStat', () => {
	it( 'maps native + all files to the all-files metric', () => {
		expect( getSiteRuntimeStat( { runtime: 'native-php', fileAccess: 'all-files' } ) ).toBe(
			StatsMetric.RUNTIME_NATIVE_ALL_FILES
		);
	} );

	it( 'maps native + site directory to the site-dir metric', () => {
		expect( getSiteRuntimeStat( { runtime: 'native-php', fileAccess: 'site-directory' } ) ).toBe(
			StatsMetric.RUNTIME_NATIVE_SITE_DIR
		);
	} );

	it( 'defaults native without file access to the site-dir metric', () => {
		expect( getSiteRuntimeStat( { runtime: 'native-php' } ) ).toBe(
			StatsMetric.RUNTIME_NATIVE_SITE_DIR
		);
	} );

	it( 'maps sandbox to the sandbox metric regardless of file access', () => {
		expect( getSiteRuntimeStat( { runtime: 'playground', fileAccess: 'all-files' } ) ).toBe(
			StatsMetric.RUNTIME_SANDBOX
		);
	} );

	it( 'defaults an unset runtime to native', () => {
		expect( getSiteRuntimeStat( {} ) ).toBe( StatsMetric.RUNTIME_NATIVE_SITE_DIR );
	} );
} );

describe( 'recordSiteRuntimeUsage', () => {
	it( 'bumps the daily runtime stat and records the marker on first start', async () => {
		await recordSiteRuntimeUsage( nativeAllFilesSite );

		expect( bumpStat ).toHaveBeenCalledWith(
			StatsGroup.STUDIO_CLI_RUNTIME_DAILY,
			StatsMetric.RUNTIME_NATIVE_ALL_FILES
		);
		expect( mockConfig.siteRuntimeStats?.[ 'site-1' ]?.bumpedAt ).toBeTypeOf( 'number' );
		expect( mockConfig.siteRuntimeStats?.[ 'site-1' ]?.stat ).toBe(
			StatsMetric.RUNTIME_NATIVE_ALL_FILES
		);
	} );

	it( 'does not bump again the same day for the same runtime', async () => {
		const today = Date.UTC( 2024, 1, 6 );
		vi.spyOn( Date, 'now' ).mockReturnValue( today );
		mockConfig.siteRuntimeStats = {
			'site-1': { bumpedAt: today, stat: StatsMetric.RUNTIME_NATIVE_ALL_FILES },
		};

		await recordSiteRuntimeUsage( nativeAllFilesSite );

		expect( saveCliConfig ).not.toHaveBeenCalled();
		expect( bumpStat ).not.toHaveBeenCalled();
	} );

	it( 'bumps again once a new day has started', async () => {
		vi.spyOn( Date, 'now' ).mockReturnValue( Date.UTC( 2024, 1, 7 ) );
		mockConfig.siteRuntimeStats = {
			'site-1': { bumpedAt: Date.UTC( 2024, 1, 6 ), stat: StatsMetric.RUNTIME_NATIVE_ALL_FILES },
		};

		await recordSiteRuntimeUsage( nativeAllFilesSite );

		expect( saveCliConfig ).toHaveBeenCalled();
		expect( bumpStat ).toHaveBeenCalledWith(
			StatsGroup.STUDIO_CLI_RUNTIME_DAILY,
			StatsMetric.RUNTIME_NATIVE_ALL_FILES
		);
	} );

	it( 'bumps again the same day when the runtime changed', async () => {
		const today = Date.UTC( 2024, 1, 6 );
		vi.spyOn( Date, 'now' ).mockReturnValue( today );
		// Counted earlier today as sandbox; the site is now native + all files.
		mockConfig.siteRuntimeStats = {
			'site-1': { bumpedAt: today, stat: StatsMetric.RUNTIME_SANDBOX },
		};

		await recordSiteRuntimeUsage( nativeAllFilesSite );

		expect( bumpStat ).toHaveBeenCalledWith(
			StatsGroup.STUDIO_CLI_RUNTIME_DAILY,
			StatsMetric.RUNTIME_NATIVE_ALL_FILES
		);
		expect( mockConfig.siteRuntimeStats?.[ 'site-1' ]?.stat ).toBe(
			StatsMetric.RUNTIME_NATIVE_ALL_FILES
		);
	} );

	it( 'does nothing when CLI telemetry is disabled', async () => {
		vi.stubGlobal( '__ENABLE_CLI_TELEMETRY__', false );

		await recordSiteRuntimeUsage( nativeAllFilesSite );

		expect( lockCliConfig ).not.toHaveBeenCalled();
		expect( bumpStat ).not.toHaveBeenCalled();
	} );
} );
