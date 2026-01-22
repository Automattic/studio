import { waitFor } from '@testing-library/react';
import { readFile, writeFile } from 'atomically';
import { vi } from 'vitest';
import {
	bumpStat,
	bumpAggregatedUniqueStat,
	AppdataProvider,
	LastBumpStatsData,
} from 'common/lib/bump-stat';
import { AggregateInterval, StatsGroup, StatsMetric } from 'common/types/stats';

vi.mock( 'atomically', () => ( {
	readFile: vi.fn(),
	writeFile: vi.fn(),
} ) );

// Store original fetch to restore later
const originalFetch = global.fetch;

// Mock appdata provider for tests
const mockAppdataProvider: AppdataProvider< LastBumpStatsData > = {
	load: async () => {
		const fileContent = await readFile( 'mock-path', 'utf-8' );
		return JSON.parse( fileContent );
	},
	lock: async () => {},
	unlock: async () => {},
	save: async ( data ) => {
		await writeFile( 'mock-path', JSON.stringify( data, null, 2 ), 'utf-8' );
	},
};

const originalEnv = { ...process.env };

afterEach( () => {
	vi.spyOn( Date, 'now' ).mockRestore();
	vi.spyOn( console, 'info' ).mockRestore();
	vi.mocked( readFile ).mockRestore();
	vi.mocked( writeFile ).mockRestore();
	global.fetch = originalFetch;
	process.env = { ...originalEnv };
} );

function mockBumpStatRequest( group: string, stat: string ) {
	let requestMade = false;

	global.fetch = vi.fn().mockImplementation( async ( url: string, options?: RequestInit ) => {
		if (
			url === 'https://public-api.wordpress.com/wpcom/v2/studio-app/bump-stat' &&
			options?.method === 'POST'
		) {
			const body = JSON.parse( options?.body as string );
			if ( body.group === group && body.stat === stat ) {
				requestMade = true;
				return Promise.resolve( {
					ok: true,
					status: 200,
					json: () => Promise.resolve( {} ),
				} as Response );
			}
		}
		return originalFetch( url, options );
	} );

	return {
		isDone: () => requestMade,
	};
}

function mockCurrentTime( timestamp: number ) {
	vi.spyOn( Date, 'now' ).mockReturnValue( timestamp );
}

describe( 'bumpStat', () => {
	let logger: ReturnType< typeof vi.spyOn >;

	beforeEach( () => {
		logger = vi.spyOn( console, 'info' ).mockImplementation( () => {} );
	} );

	test( 'record stat with GET request to b.gif', async () => {
		const mockRequest = mockBumpStatRequest( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS );

		bumpStat( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS );

		await waitFor( () => expect( mockRequest.isDone() ).toBe( true ) );
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
		const mockRequest = mockBumpStatRequest( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS );

		bumpStat( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS, true );

		expect( logger ).not.toHaveBeenCalled();
		await waitFor( () => expect( mockRequest.isDone() ).toBe( true ) );
	} );

	test( 'should not bump stat when group exceeds 27 characters', () => {
		const errorLogger = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		const longGroup = 'this-is-a-very-long-group-name-over-27-chars' as StatsGroup;

		const result = bumpStat( longGroup, StatsMetric.SUCCESS );

		expect( result ).toBe( false );
		expect( errorLogger ).toHaveBeenCalledWith(
			expect.stringContaining( 'exceeds maximum length of 27 characters' )
		);
		errorLogger.mockRestore();
	} );

	test( 'should not bump stat when stat exceeds 32 characters', () => {
		const errorLogger = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
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
		const mockRequest = mockBumpStatRequest( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS );

		vi.mocked( readFile ).mockResolvedValue(
			Buffer.from(
				JSON.stringify( {
					lastBumpStats: {},
					sites: [],
				} )
			)
		);

		await bumpAggregatedUniqueStat(
			StatsGroup.STUDIO_APP_LAUNCH,
			StatsMetric.SUCCESS,
			'weekly',
			mockAppdataProvider
		);

		await waitFor( () => expect( mockRequest.isDone() ).toBe( true ) );
	} );

	test.each< [ AggregateInterval, number, number ] >( [
		[ 'daily', Date.UTC( 2024, 1, 2 ), Date.UTC( 2024, 1, 1 ) ],
		[ 'weekly', Date.UTC( 2024, 1, 4 ), Date.UTC( 2024, 1, 1 ) ], // Note that Sunday counts as the start of the week
		[ 'monthly', Date.UTC( 2024, 0, 1 ), Date.UTC( 2023, 0, 1 ) ],
	] )(
		'bump %s stat when it has been more than the specified interval since last recorded',
		async ( aggregateBy: AggregateInterval, currentTime: number, lastBumpTime: number ) => {
			mockCurrentTime( currentTime );

			const mockRequest = mockBumpStatRequest( StatsGroup.STUDIO_APP_LAUNCH, StatsMetric.SUCCESS );
			vi.mocked( readFile ).mockResolvedValue(
				Buffer.from(
					JSON.stringify( {
						lastBumpStats: {
							[ StatsGroup.STUDIO_APP_LAUNCH ]: {
								[ StatsMetric.SUCCESS ]: lastBumpTime,
							},
						},
						sites: [],
					} )
				)
			);

			await bumpAggregatedUniqueStat(
				StatsGroup.STUDIO_APP_LAUNCH,
				StatsMetric.SUCCESS,
				aggregateBy,
				mockAppdataProvider
			);

			await waitFor( () => expect( mockRequest.isDone() ).toBe( true ) );

			expect( writeFile ).toHaveBeenCalled();
			const savedData = JSON.parse( vi.mocked( writeFile ).mock.calls[ 0 ][ 1 ] as string );
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
		async ( aggregateBy: AggregateInterval, currentTime: number, lastBumpTime: number ) => {
			mockCurrentTime( currentTime );

			// Don't create a nock mock so that we get errors if a network request is made

			vi.mocked( readFile ).mockResolvedValue(
				Buffer.from(
					JSON.stringify( {
						lastBumpStats: {
							[ StatsGroup.STUDIO_APP_LAUNCH ]: {
								[ StatsMetric.SUCCESS ]: lastBumpTime,
							},
						},
						sites: [],
					} )
				)
			);

			await bumpAggregatedUniqueStat(
				StatsGroup.STUDIO_APP_LAUNCH,
				StatsMetric.SUCCESS,
				aggregateBy,
				mockAppdataProvider
			);

			expect( writeFile ).not.toHaveBeenCalled();
		}
	);
} );
