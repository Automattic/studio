import { describe, expect, it } from 'vitest';
import { overallPercent, PullStep, withPercent } from './pull-progress';

describe( 'overallPercent', () => {
	it( 'parks a step with no measurable progress at the start of its band', () => {
		expect( overallPercent( PullStep.FILES ) ).toBe( 5 );
		expect( overallPercent( PullStep.DATABASE ) ).toBe( 55 );
	} );

	it( 'interpolates a step fraction within that band', () => {
		// Files span 5–55, so halfway through the files step is 30 overall.
		expect( overallPercent( PullStep.FILES, 0.5 ) ).toBe( 30 );
		expect( overallPercent( PullStep.FILES, 1 ) ).toBe( 55 );
	} );

	it( 'reaches exactly 100 only at the end of the final step', () => {
		expect( overallPercent( PullStep.REMAINING, 1 ) ).toBe( 100 );
		expect( overallPercent( PullStep.START, 1 ) ).toBeLessThan( 100 );
	} );

	it( 'clamps a fraction that overshoots or goes negative so the bar cannot leave its band', () => {
		// Reprint restarts partial transfers, so counters can regress or exceed
		// their total mid-stream; neither may move the bar out of the band.
		expect( overallPercent( PullStep.FILES, 5 ) ).toBe( 55 );
		expect( overallPercent( PullStep.FILES, -2 ) ).toBe( 5 );
	} );

	it( 'never moves backwards across steps run in order', () => {
		const order = [
			PullStep.SETUP,
			PullStep.PREFLIGHT,
			PullStep.FILES,
			PullStep.DATABASE,
			PullStep.FLATTEN,
			PullStep.RUNTIME,
			PullStep.LINK,
			PullStep.START,
			PullStep.REMAINING,
		];
		const starts = order.map( ( step ) => overallPercent( step ) );
		expect( starts ).toEqual( [ ...starts ].sort( ( a, b ) => a - b ) );

		// A step's completion never exceeds the next step's start, so skipping a
		// step (e.g. --skip-database) jumps forward rather than stalling.
		order.slice( 0, -1 ).forEach( ( step, index ) => {
			expect( overallPercent( step, 1 ) ).toBeLessThanOrEqual( starts[ index + 1 ] );
		} );
	} );
} );

describe( 'withPercent', () => {
	it( 'appends the token pullSite parses out of the message', () => {
		const message = withPercent( 'Pulling files · 42/1337 files', 30 );
		expect( message ).toBe( 'Pulling files · 42/1337 files (30%)' );
		expect( /\((\d+)%\)/.exec( message )?.[ 1 ] ).toBe( '30' );
	} );
} );
