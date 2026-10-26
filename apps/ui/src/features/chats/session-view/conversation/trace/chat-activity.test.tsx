import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnActivityLine } from '@/features/chats/session-view/conversation/trace';
import type { TurnActivity } from '@/features/chats/session-view/conversation/transcript-items';

const activity: TurnActivity = {
	kind: 'activity',
	key: 'turn:activity',
	startedAt: 1000,
	endedAt: null,
	status: 'running',
};

const line = ( overrides: Partial< TurnActivity > = {} ) => (
	<TurnActivityLine
		activity={ { ...activity, ...overrides } }
		waitingOnUser={ false }
		progressMessage={ null }
	/>
);

afterEach( () => vi.useRealTimers() );

describe( 'turn activity line', () => {
	it.each( [
		[ 'running', null, 'Working for 3s' ],
		[ 'success', 4000, 'Worked for 3s' ],
		[ 'interrupted', 4000, 'Stopped after 3s' ],
		[ 'error', 4000, 'Failed after 3s' ],
	] as const )( 'keeps %s activity non-interactive', ( status, endedAt, label ) => {
		vi.useFakeTimers();
		vi.setSystemTime( 4000 );
		render( line( { status, endedAt } ) );
		expect( screen.getByText( label ) ).toBeVisible();
		expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
	} );

	it( 'counts elapsed time and keeps the final duration when work completes', async () => {
		vi.useFakeTimers();
		vi.setSystemTime( 4000 );
		const view = render( line() );
		expect( screen.getByText( 'Working for 3s' ) ).toBeVisible();
		await act( () => vi.advanceTimersByTime( 2000 ) );
		expect( screen.getByText( 'Working for 5s' ) ).toBeVisible();
		view.rerender( line( { status: 'success', endedAt: 6000 } ) );
		expect( screen.getByText( 'Worked for 5s' ) ).toBeVisible();
		await act( () => vi.advanceTimersByTime( 5000 ) );
		expect( screen.getByText( 'Worked for 5s' ) ).toBeVisible();
	} );

	it.each( [
		[ 'interrupted', 'Stopped after 4s' ],
		[ 'error', 'Failed after 4s' ],
	] as const )( 'labels %s turns', ( status, label ) => {
		render( line( { status, endedAt: 5000 } ) );
		expect( screen.getByText( label ) ).toBeVisible();
	} );

	it( 'omits duration when historical timestamps are unavailable', () => {
		render( line( { status: 'success', startedAt: null } ) );
		expect( screen.getByText( /^Worked$/ ) ).toBeVisible();
	} );
} );
