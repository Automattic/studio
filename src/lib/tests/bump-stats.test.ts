import { waitFor } from '@testing-library/react';
import nock from 'nock';
import { loadUserData, saveUserData } from '../../storage/user-data';
import { bumpAggregatedUniqueStat, bumpStat } from '../bump-stats';

jest.mock( '../../storage/user-data' );

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
	return nock( 'https://pixel.wp.com' )
		.get( '/b.gif' )
		.query( {
			v: 'wpcom-no-pv',
			[ `x_${ group }` ]: stat,
		} )
		.reply( 200 );
}

function mockCurrentTime( timestamp: number ) {
	jest.spyOn( Date, 'now' ).mockReturnValue( timestamp );
}

describe( 'bumpStat', () => {
	test( 'record stat with GET request to b.gif', async () => {
		const nock = mockBumpStatRequest( 'usage', 'launch' );

		bumpStat( 'usage', 'launch' );

		await waitFor( () => expect( nock.isDone() ).toBe( true ) );
	} );

	test( "don't record stat in e2e tests", () => {
		process.env.E2E = 'true';
		const logger = jest.spyOn( console, 'info' );

		bumpStat( 'usage', 'launch' );

		expect( logger ).toHaveBeenCalledWith( 'Would have bumped stat: usage=launch' );
	} );

	test( "don't record stat in development mode", () => {
		process.env.NODE_ENV = 'development';
		const logger = jest.spyOn( console, 'info' );

		bumpStat( 'usage', 'launch' );

		expect( logger ).toHaveBeenCalledWith( 'Would have bumped stat: usage=launch' );
	} );

	test( 'record stat in development mode if override arg is used', async () => {
		process.env.NODE_ENV = 'development';
		const logger = jest.spyOn( console, 'info' );
		const nock = mockBumpStatRequest( 'usage', 'launch' );

		bumpStat( 'usage', 'launch', true );

		expect( logger ).not.toHaveBeenCalled();
		await waitFor( () => expect( nock.isDone() ).toBe( true ) );
	} );
} );

describe( 'bumpAggregatedUniqueStat', () => {
	test( 'bump stat when it has never been recorded before', async () => {
		const nock = mockBumpStatRequest( 'usage', 'launch' );

		( loadUserData as jest.Mock ).mockResolvedValue( { lastBumpStats: {} } );

		bumpAggregatedUniqueStat( 'usage', 'launch', 'weekly' );

		await waitFor( () => expect( nock.isDone() ).toBe( true ) );
	} );

	for ( const [ aggregateBy, currentTime, lastBumpTime ] of [
		[ 'daily', Date.UTC( 2024, 1, 2 ), Date.UTC( 2024, 1, 1 ) ],
		[ 'weekly', Date.UTC( 2024, 1, 4 ), Date.UTC( 2024, 1, 1 ) ], // Note that Sunday counts as the start of the week
		[ 'monthly', Date.UTC( 2024, 0, 1 ), Date.UTC( 2023, 0, 1 ) ],
	] as const ) {
		test( `bump ${ aggregateBy } stat when it has been more than the specified interval since last recorded`, async () => {
			mockCurrentTime( currentTime );

			const nock = mockBumpStatRequest( 'usage', 'launch' );
			( loadUserData as jest.Mock ).mockResolvedValue( {
				lastBumpStats: {
					usage: {
						launch: lastBumpTime,
					},
				},
			} );

			bumpAggregatedUniqueStat( 'usage', 'launch', aggregateBy );

			await waitFor( () => expect( nock.isDone() ).toBe( true ) );

			expect( saveUserData ).toHaveBeenCalledWith(
				expect.objectContaining( {
					lastBumpStats: {
						usage: {
							launch: currentTime,
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
					usage: {
						launch: lastBumpTime,
					},
				},
			} );

			bumpAggregatedUniqueStat( 'usage', 'launch', aggregateBy );

			expect( saveUserData ).not.toHaveBeenCalled();
		} );
	}
} );
