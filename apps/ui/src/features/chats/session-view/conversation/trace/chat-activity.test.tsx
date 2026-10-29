import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnActivityLine } from '@/features/chats/session-view/conversation/trace';
import type { TurnActivity } from '@/features/chats/session-view/conversation/transcript-items';

const activity: TurnActivity = {
	kind: 'activity',
	items: [ { kind: 'tool-use', key: 'tool', name: 'Read' } ],
	key: 'turn:activity',
	startedAt: 1000,
	endedAt: null,
	status: 'running',
};

const line = ( overrides: Partial< TurnActivity > = {}, waitingOnUser = false ) => (
	<TurnActivityLine
		activity={ { ...activity, ...overrides } }
		waitingOnUser={ waitingOnUser }
		progressMessage={ null }
		renderItems={ () => <p>Reading files</p> }
	/>
);

afterEach( () => vi.useRealTimers() );

describe( 'turn activity line', () => {
	it.each( [
		[ 'running', null, 'Working for 3s' ],
		[ 'success', 4000, 'Worked for 3s' ],
		[ 'interrupted', 4000, 'You stopped after 3s' ],
		[ 'error', 4000, 'Failed after 3s' ],
	] as const )(
		'defaults %s activity to the appropriate expansion state',
		( status, endedAt, label ) => {
			vi.useFakeTimers();
			vi.setSystemTime( 4000 );
			render( line( { status, endedAt } ) );
			expect( screen.getByText( label ) ).toBeVisible();
			expect( screen.getByRole( 'button', { name: label } ) ).toHaveAttribute(
				'aria-expanded',
				String( status === 'running' )
			);
		}
	);

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

	it( 'omits duration when historical timestamps are unavailable', () => {
		render( line( { status: 'success', startedAt: null } ) );
		expect( screen.getByText( /^Worked$/ ) ).toBeVisible();
	} );
} );

describe( 'activity disclosure', () => {
	it.each( [ 'success', 'interrupted', 'error' ] as const )(
		'collapses on %s and can reopen',
		( status ) => {
			const view = render( line() );
			expect( screen.getByText( 'Reading files' ) ).toBeVisible();
			view.rerender( line( { status, endedAt: 6000 } ) );
			expect( screen.getByRole( 'button' ) ).toHaveAttribute( 'aria-expanded', 'false' );
			fireEvent.click( screen.getByRole( 'button' ) );
			expect( screen.getByRole( 'button' ) ).toHaveAttribute( 'aria-expanded', 'true' );
			expect( screen.getByText( 'Reading files' ) ).toBeVisible();
			view.rerender( line( { status, endedAt: 6000 } ) );
			expect( screen.getByRole( 'button' ) ).toHaveAttribute( 'aria-expanded', 'true' );
		}
	);
	it( 'preserves a manual collapse through live updates and reopens for a new run', () => {
		const view = render( line() );
		fireEvent.click( screen.getByRole( 'button' ) );
		view.rerender( line( { startedAt: 2000 } ) );
		expect( screen.getByRole( 'button' ) ).toHaveAttribute( 'aria-expanded', 'false' );
		view.rerender( line( { status: 'success', endedAt: 6000 } ) );
		view.rerender( line() );
		expect( screen.getByRole( 'button' ) ).toHaveAttribute( 'aria-expanded', 'true' );
	} );
} );

describe( 'empty activity', () => {
	it.each( [ 'running', 'success', 'interrupted', 'error' ] as const )(
		'renders %s without a disclosure when empty',
		( status ) => {
			render( line( { status, items: [] } ) );
			expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
			expect( screen.queryByText( 'Reading files' ) ).not.toBeInTheDocument();
		}
	);
	it( 'becomes expanded when the first activity arrives', () => {
		const view = render( line( { items: [] } ) );
		expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
		view.rerender( line() );
		expect( screen.getByRole( 'button' ) ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( screen.getByText( 'Reading files' ) ).toBeVisible();
		view.rerender( line( { status: 'success', items: [], endedAt: 6000 } ) );
		expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
	} );
	it( 'allows live progress alone to expand but ignores empty progress', () => {
		const element = ( progressMessage: string, status: TurnActivity[ 'status' ] = 'running' ) => (
			<TurnActivityLine
				activity={ { ...activity, status, items: [] } }
				waitingOnUser={ false }
				progressMessage={ progressMessage }
			/>
		);
		const view = render( element( '   ' ) );
		expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
		view.rerender( element( 'Uploading…' ) );
		expect( screen.getByRole( 'button' ) ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( screen.getByText( 'Uploading…' ) ).toBeVisible();
		view.rerender( element( 'Uploading…', 'success' ) );
		expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
	} );
} );

describe( 'waiting activity', () => {
	it( 'counts elapsed time while waiting without shimmer and restores working after an answer', async () => {
		vi.useFakeTimers();
		vi.setSystemTime( 4000 );
		const view = render( line() );
		expect( screen.getByText( 'Working for 3s' ) ).toHaveClass( 'studio-shimmer' );
		view.rerender( line( {}, true ) );
		expect( screen.getByText( 'Waiting for 3s' ) ).not.toHaveClass( 'studio-shimmer' );
		expect( screen.getByRole( 'button', { name: 'Waiting for 3s' } ) ).toHaveAttribute(
			'aria-expanded',
			'false'
		);
		await act( () => vi.advanceTimersByTime( 10000 ) );
		expect( screen.getByText( 'Waiting for 13s' ) ).toBeVisible();
		view.rerender( line() );
		expect( screen.getByText( 'Working for 13s' ) ).toHaveClass( 'studio-shimmer' );
		expect( screen.getByRole( 'button' ) ).toHaveAttribute( 'aria-expanded', 'true' );
	} );
	it( 'allows details to reopen while waiting and collapses again for the next question', () => {
		const view = render( line( {}, true ) );
		expect( screen.getByRole( 'button' ) ).toHaveAttribute( 'aria-expanded', 'false' );
		fireEvent.click( screen.getByRole( 'button' ) );
		view.rerender( line( { startedAt: 2000 }, true ) );
		expect( screen.getByRole( 'button' ) ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( screen.getByText( 'Reading files' ) ).toBeVisible();
		view.rerender( line() );
		view.rerender( line( {}, true ) );
		expect( screen.getByRole( 'button' ) ).toHaveAttribute( 'aria-expanded', 'false' );
		fireEvent.click( screen.getByRole( 'button' ) );
		view.rerender( line( { status: 'success', endedAt: 6000 }, true ) );
		expect( screen.getByRole( 'button' ) ).toHaveAttribute( 'aria-expanded', 'false' );
	} );
	it( 'does not override a completed status with a stale pending question', () => {
		render( line( { status: 'success', endedAt: 6000 }, true ) );
		expect( screen.getByText( 'Worked for 5s' ) ).toBeVisible();
		expect( screen.queryByText( /^Waiting for/ ) ).not.toBeInTheDocument();
	} );
} );

it( 'labels an immediate stop with zero elapsed seconds', () => {
	render( line( { status: 'interrupted', endedAt: 1000, items: [] } ) );
	expect( screen.getByText( 'You stopped after 0s' ) ).toBeVisible();
	expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
} );

it( 'uses You stopped when historical timestamps are missing', () => {
	render( line( { status: 'interrupted', startedAt: null, endedAt: null, items: [] } ) );
	expect( screen.getByText( 'You stopped' ) ).toBeVisible();
} );
