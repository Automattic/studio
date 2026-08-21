import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatElapsedTime, ThinkingIndicator } from './index';

describe( 'ThinkingIndicator', () => {
	it( 'uses the shared working mark without adding a nested status', () => {
		const { container } = render(
			<ThinkingIndicator active startedAt={ Date.now() } progressMessage={ null } />
		);

		expect( screen.getAllByRole( 'status' ) ).toHaveLength( 1 );
		expect( container.querySelector( '[aria-hidden="true"]' ) ).toBeInTheDocument();
	} );
} );

describe( 'formatElapsedTime', () => {
	it.each( [
		[ 0, '0s' ],
		[ 1, '1s' ],
		[ 60, '1m 0s' ],
		[ 80, '1m 20s' ],
		[ 908, '15m 8s' ],
		[ 3600, '1h 0s' ],
		[ 5266, '1h 27m 46s' ],
		[ 3601, '1h 1s' ],
		[ -5, '0s' ],
	] )( 'formats %i seconds as %s', ( seconds, expected ) => {
		expect( formatElapsedTime( seconds ) ).toBe( expected );
	} );
} );
