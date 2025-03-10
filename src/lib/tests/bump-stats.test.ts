import { waitFor } from '@testing-library/react';
import nock from 'nock';
import { bumpAggregatedUniqueStat, bumpStat } from 'src/lib/bump-stats';
import {
	StatsGroup,
	StatsMetric,
	getWordPressVersionMetric,
	getPHPVersionMetric,
} from 'src/lib/bump-stats/types';
import { loadUserData, saveUserData } from 'src/storage/user-data';

jest.mock( 'src/storage/user-data' );

const originalEnv = { ...process.env };
afterEach( () => {
	jest.spyOn( Date, 'now' ).mockRestore();
	jest.spyOn( console, 'info' ).mockRestore();
	( loadUserData as jest.Mock ).mockRestore();
	( saveUserData as jest.Mock ).mockRestore();
	nock.cleanAll();
	process.env = { ...originalEnv };
} );

function mockBumpStatRequest( group: string, stat: string ) {
	return nock( 'https://public-api.wordpress.com' )
		.post( '/wpcom/v2/studio-app/bump-stat', {
			group,
			stat,
		} )
		.matchHeader( 'Content-Type', 'application/json' )
		.reply( 200 );
}

function mockCurrentTime( timestamp: number ) {
	jest.spyOn( Date, 'now' ).mockReturnValue( timestamp );
}

describe( 'bumpStat', () => {
	let logger: jest.SpyInstance;

	beforeEach( () => {
		logger = jest.spyOn( console, 'info' ).mockImplementation( () => {} );
	} );

	test( 'record stat with GET request to b.gif', async () => {
		const nock = mockBumpStatRequest( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS );

		bumpStat( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS );

		await waitFor( () => expect( nock.isDone() ).toBe( true ) );
	} );

	test( "don't record stat in e2e tests", () => {
		process.env.E2E = 'true';

		bumpStat( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS );

		expect( logger ).toHaveBeenCalledWith(
			`Would have bumped stat: ${ StatsGroup.STUDIO_APP_LAUNCH }=${ StatsMetric.SUCCESS }`
		);
	} );

	test( "don't record stat in development mode", () => {
		process.env.NODE_ENV = 'development';

		bumpStat( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS );

		expect( logger ).toHaveBeenCalledWith(
			`Would have bumped stat: ${ StatsGroup.STUDIO_APP_LAUNCH }=${ StatsMetric.SUCCESS }`
		);
	} );

	test( 'record stat in development mode if override arg is used', async () => {
		process.env.NODE_ENV = 'development';
		const nock = mockBumpStatRequest( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS );

		bumpStat( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS, true );

		expect( logger ).not.toHaveBeenCalled();
		await waitFor( () => expect( nock.isDone() ).toBe( true ) );
	} );
} );

describe( 'bumpAggregatedUniqueStat', () => {
	test( 'bump stat when it has never been recorded before', async () => {
		const nock = mockBumpStatRequest( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS );

		( loadUserData as jest.Mock ).mockResolvedValue( { lastBumpStats: {} } );

		bumpAggregatedUniqueStat( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS, 'weekly' );

		await waitFor( () => expect( nock.isDone() ).toBe( true ) );
	} );

	for ( const [ aggregateBy, currentTime, lastBumpTime ] of [
		[ 'daily', Date.UTC( 2024, 1, 2 ), Date.UTC( 2024, 1, 1 ) ],
		[ 'weekly', Date.UTC( 2024, 1, 4 ), Date.UTC( 2024, 1, 1 ) ], // Note that Sunday counts as the start of the week
		[ 'monthly', Date.UTC( 2024, 0, 1 ), Date.UTC( 2023, 0, 1 ) ],
	] as const ) {
		test( `bump ${ aggregateBy } stat when it has been more than the specified interval since last recorded`, async () => {
			mockCurrentTime( currentTime );

			const nock = mockBumpStatRequest( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS );
			( loadUserData as jest.Mock ).mockResolvedValue( {
				lastBumpStats: {
					[ StatsGroup.STUDIO_APP_LAUNCH ]: {
						[ StatsMetric.SUCCESS ]: lastBumpTime,
					},
				},
			} );

			bumpAggregatedUniqueStat( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS, aggregateBy );

			await waitFor( () => expect( nock.isDone() ).toBe( true ) );

			expect( saveUserData ).toHaveBeenCalledWith(
				expect.objectContaining( {
					lastBumpStats: {
						[ StatsGroup.STUDIO_APP_LAUNCH ]: {
							[ StatsMetric.SUCCESS ]: currentTime,
						},
					},
				} )
			);
		} );
	}

	for ( const [ aggregateBy, currentTime, lastBumpTime ] of [
		[ 'daily', Date.UTC( 2024, 1, 1 ), Date.UTC( 2024, 1, 1 ) ],
		[ 'weekly', Date.UTC( 2024, 1, 6 ), Date.UTC( 2024, 1, 4 ) ], // Note that Sunday counts as the start of the week
		[ 'monthly', Date.UTC( 2024, 0, 1 ), Date.UTC( 2024, 0, 11 ) ],
	] as const ) {
		test( `don't bump ${ aggregateBy } stat when it has already been recorded in the specified interval`, async () => {
			mockCurrentTime( currentTime );

			// Don't create a nock mock so that we get errors if a network request is made

			( loadUserData as jest.Mock ).mockResolvedValue( {
				lastBumpStats: {
					[ StatsGroup.STUDIO_APP_LAUNCH ]: {
						[ StatsMetric.SUCCESS ]: lastBumpTime,
					},
				},
			} );

			bumpAggregatedUniqueStat( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS, aggregateBy );

			expect( saveUserData ).not.toHaveBeenCalled();
		} );
	}
} );

describe( 'getWordPressVersionMetric', () => {
	test( 'should convert WordPress version to a valid metric', () => {
		expect( getWordPressVersionMetric( '6.4' ) ).toEqual( `${ StatsMetric.WP_VERSION_PREFIX }6-4` );
		expect( getWordPressVersionMetric( '6.4.1' ) ).toEqual(
			`${ StatsMetric.WP_VERSION_PREFIX }6-4-1`
		);
		expect( getWordPressVersionMetric( 'latest' ) ).toEqual(
			`${ StatsMetric.WP_VERSION_PREFIX }latest`
		);
	} );
} );

describe( 'getPHPVersionMetric', () => {
	test( 'should convert PHP version to a valid metric', () => {
		expect( getPHPVersionMetric( '8.2' ) ).toEqual( `${ StatsMetric.PHP_VERSION_PREFIX }8-2` );
		expect( getPHPVersionMetric( '8.0' ) ).toEqual( `${ StatsMetric.PHP_VERSION_PREFIX }8-0` );
		expect( getPHPVersionMetric( '7.4' ) ).toEqual( `${ StatsMetric.PHP_VERSION_PREFIX }7-4` );
	} );
} );
