import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { updateConfig } from '@studio/common/lib/config/store';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bumpStat } from 'cli/lib/bump-stat';
import { StatsGroup, StatsMetric } from 'cli/lib/types/bump-stats';
import { getSiteRuntimeStat, recordSiteRuntimeUsage } from '../site-runtime-stats';
import type { ConfigSite } from '@studio/common/lib/config/schema';

let config: { sites: ConfigSite[] };

vi.mock( 'cli/lib/bump-stat', () => ( { bumpStat: vi.fn() } ) );
vi.mock( '@studio/common/lib/config/store', () => ( {
	updateConfig: vi.fn( async ( update: ( value: typeof config ) => void ) => update( config ) ),
} ) );

const nativeAllFilesSite: ConfigSite = {
	id: 'site-1',
	name: 'My WordPress Site',
	path: '/home/user/Studio/my-wordpress-site',
	port: 8888,
	fileAccess: 'all-files',
	phpVersion: DEFAULT_PHP_VERSION,
} as const;

const runtimeStat = () => config.sites[ 0 ].runtimeStat;

beforeEach( () => {
	vi.stubGlobal( '__ENABLE_CLI_TELEMETRY__', true );
	config = { sites: [ { ...nativeAllFilesSite } ] };
} );

afterEach( () => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
} );

describe( 'getSiteRuntimeStat', () => {
	it( 'maps native + all files to the all-files metric', () => {
		expect( getSiteRuntimeStat( { fileAccess: 'all-files' } ) ).toBe(
			StatsMetric.RUNTIME_NATIVE_ALL_FILES
		);
	} );

	it( 'maps native + site directory to the site-dir metric', () => {
		expect( getSiteRuntimeStat( { fileAccess: 'site-directory' } ) ).toBe(
			StatsMetric.RUNTIME_NATIVE_SITE_DIR
		);
	} );

	it( 'defaults an unset file access to the site-dir metric', () => {
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
		expect( runtimeStat() ).toEqual( {
			bumpedAt: expect.any( Number ),
			stat: StatsMetric.RUNTIME_NATIVE_ALL_FILES,
		} );
	} );

	it( 'does not bump again the same day for the same runtime', async () => {
		const today = Date.UTC( 2024, 1, 6 );
		vi.spyOn( Date, 'now' ).mockReturnValue( today );
		config.sites[ 0 ].runtimeStat = {
			bumpedAt: today + 1000,
			stat: StatsMetric.RUNTIME_NATIVE_ALL_FILES,
		};

		await recordSiteRuntimeUsage( nativeAllFilesSite );

		expect( runtimeStat()?.bumpedAt ).toBe( today + 1000 );
		expect( bumpStat ).not.toHaveBeenCalled();
	} );

	it( 'bumps again once a new day has started', async () => {
		vi.spyOn( Date, 'now' ).mockReturnValue( Date.UTC( 2024, 1, 7 ) );
		config.sites[ 0 ].runtimeStat = {
			bumpedAt: Date.UTC( 2024, 1, 6 ),
			stat: StatsMetric.RUNTIME_NATIVE_ALL_FILES,
		};

		await recordSiteRuntimeUsage( nativeAllFilesSite );

		expect( runtimeStat()?.bumpedAt ).toBe( Date.UTC( 2024, 1, 7 ) );
		expect( bumpStat ).toHaveBeenCalledWith(
			StatsGroup.STUDIO_CLI_RUNTIME_DAILY,
			StatsMetric.RUNTIME_NATIVE_ALL_FILES
		);
	} );

	it( 'bumps again the same day when the file access changed', async () => {
		const today = Date.UTC( 2024, 1, 6 );
		vi.spyOn( Date, 'now' ).mockReturnValue( today );
		// Counted earlier today as site directory; the site now has all-files access.
		config.sites[ 0 ].runtimeStat = { bumpedAt: today, stat: StatsMetric.RUNTIME_NATIVE_SITE_DIR };

		await recordSiteRuntimeUsage( nativeAllFilesSite );

		expect( bumpStat ).toHaveBeenCalledWith(
			StatsGroup.STUDIO_CLI_RUNTIME_DAILY,
			StatsMetric.RUNTIME_NATIVE_ALL_FILES
		);
		expect( runtimeStat()?.stat ).toBe( StatsMetric.RUNTIME_NATIVE_ALL_FILES );
	} );

	it( 'does nothing when CLI telemetry is disabled', async () => {
		vi.stubGlobal( '__ENABLE_CLI_TELEMETRY__', false );

		await recordSiteRuntimeUsage( nativeAllFilesSite );

		expect( updateConfig ).not.toHaveBeenCalled();
		expect( bumpStat ).not.toHaveBeenCalled();
	} );
} );
