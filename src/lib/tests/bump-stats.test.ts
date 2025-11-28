import { waitFor } from '@testing-library/react';
import { readFile, writeFile } from 'atomically';
import nock from 'nock';
import { bumpStat } from 'common/lib/bump-stat';
import { AggregateInterval, StatsGroup, StatsMetric } from 'common/types/stats';
import { bumpAggregatedUniqueStat } from 'src/lib/bump-stats';

jest.mock( 'atomically', () => ( {
	readFile: jest.fn(),
	writeFile: jest.fn(),
} ) );

const originalEnv = { ...process.env };

afterEach( () => {
	jest.spyOn( Date, 'now' ).mockRestore();
	jest.spyOn( console, 'info' ).mockRestore();
	( readFile as jest.Mock ).mockRestore();
	( writeFile as jest.Mock ).mockRestore();
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

	test( 'should not bump stat when group exceeds 26 characters', () => {
		const errorLogger = jest.spyOn( console, 'error' ).mockImplementation( () => {} );
		const longGroup = 'this-is-a-very-long-group-name-over-26-chars' as StatsGroup;

		const result = bumpStat( longGroup, StatsMetric.SUCCESS );

		expect( result ).toBe( false );
		expect( errorLogger ).toHaveBeenCalledWith(
			expect.stringContaining( 'exceeds maximum length of 26 characters' )
		);
		errorLogger.mockRestore();
	} );

	test( 'should not bump stat when stat exceeds 32 characters', () => {
		const errorLogger = jest.spyOn( console, 'error' ).mockImplementation( () => {} );
		const longStat = 'this-is-a-very-long-stat-name-over-32-characters' as StatsMetric;

		const result = bumpStat( StatsGroup.STUDIO_APP_LAUNCH, longStat );

		expect( result ).toBe( false );
		expect( errorLogger ).toHaveBeenCalledWith(
			expect.stringContaining( 'exceeds maximum length of 32 characters' )
		);
		errorLogger.mockRestore();
	} );
} );

describe( 'bumpAggregatedUniqueStat', () => {
	test( 'bump stat when it has never been recorded before', async () => {
		const nock = mockBumpStatRequest( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS );

		( readFile as jest.Mock ).mockResolvedValue(
			JSON.stringify( {
				lastBumpStats: {},
				sites: [],
			} )
		);

		bumpAggregatedUniqueStat( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS, 'weekly' );

		await waitFor( () => expect( nock.isDone() ).toBe( true ) );
	} );

	test.each< [ AggregateInterval, number, number ] >( [
		[ 'daily', Date.UTC( 2024, 1, 2 ), Date.UTC( 2024, 1, 1 ) ],
		[ 'weekly', Date.UTC( 2024, 1, 4 ), Date.UTC( 2024, 1, 1 ) ], // Note that Sunday counts as the start of the week
		[ 'monthly', Date.UTC( 2024, 0, 1 ), Date.UTC( 2023, 0, 1 ) ],
	] )(
		'bump %s stat when it has been more than the specified interval since last recorded',
		async ( aggregateBy, currentTime, lastBumpTime ) => {
			mockCurrentTime( currentTime );

			const nock = mockBumpStatRequest( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS );
			( readFile as jest.Mock ).mockResolvedValue(
				JSON.stringify( {
					lastBumpStats: {
						[ StatsGroup.STUDIO_APP_LAUNCH ]: {
							[ StatsMetric.SUCCESS ]: lastBumpTime,
						},
					},
					sites: [],
				} )
			);

			bumpAggregatedUniqueStat( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS, aggregateBy );

			await waitFor( () => expect( nock.isDone() ).toBe( true ) );

			expect( writeFile ).toHaveBeenCalled();
			const savedData = JSON.parse( ( writeFile as jest.Mock ).mock.calls[ 0 ][ 1 ] );
			expect( savedData ).toMatchObject( {
				lastBumpStats: {
					[ StatsGroup.STUDIO_APP_LAUNCH ]: {
						[ StatsMetric.SUCCESS ]: currentTime,
					},
				},
			} );
		}
	);

	test.each< [ AggregateInterval, number, number ] >( [
		[ 'daily', Date.UTC( 2024, 1, 1 ), Date.UTC( 2024, 1, 1 ) ],
		[ 'weekly', Date.UTC( 2024, 1, 6 ), Date.UTC( 2024, 1, 4 ) ], // Note that Sunday counts as the start of the week
		[ 'monthly', Date.UTC( 2024, 0, 1 ), Date.UTC( 2024, 0, 11 ) ],
	] )(
		"don't bump %s stat when it has already been recorded in the specified interval",
		async ( aggregateBy, currentTime, lastBumpTime ) => {
			mockCurrentTime( currentTime );

			// Don't create a nock mock so that we get errors if a network request is made

			( readFile as jest.Mock ).mockResolvedValue(
				JSON.stringify( {
					lastBumpStats: {
						[ StatsGroup.STUDIO_APP_LAUNCH ]: {
							[ StatsMetric.SUCCESS ]: lastBumpTime,
						},
					},
					sites: [],
				} )
			);

			bumpAggregatedUniqueStat( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS, aggregateBy );

			expect( writeFile ).not.toHaveBeenCalled();
		}
	);
} );
