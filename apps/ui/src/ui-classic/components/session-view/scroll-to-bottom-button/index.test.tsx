import { fireEvent, render, screen } from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useStickToBottom } from '../use-stick-to-bottom';
import { ScrollToBottomButton } from '.';

function Harness( { sessionId = 'session-1' }: { sessionId?: string } ) {
	const scrollRef = useRef< HTMLDivElement >( null );
	const { isAtBottom, scrollToBottom } = useStickToBottom( scrollRef, sessionId );
	return (
		<Tooltip.Provider delay={ 0 }>
			<div data-testid="scroller" ref={ scrollRef } />
			<ScrollToBottomButton visible={ ! isAtBottom } onClick={ scrollToBottom } />
		</Tooltip.Provider>
	);
}

function setScrollMetrics(
	node: HTMLElement,
	{
		scrollHeight,
		clientHeight,
		scrollTop,
	}: { scrollHeight: number; clientHeight: number; scrollTop: number }
) {
	Object.defineProperty( node, 'scrollHeight', { value: scrollHeight, configurable: true } );
	Object.defineProperty( node, 'clientHeight', { value: clientHeight, configurable: true } );
	node.scrollTop = scrollTop;
}

function getButton() {
	// The button drops its accessible name while aria-hidden, so query by
	// role alone — the harness renders a single button.
	return screen.getByRole( 'button', { hidden: true } );
}

describe( 'ScrollToBottomButton', () => {
	it( 'stays hidden while the scroller is pinned to the bottom', () => {
		render( <Harness /> );
		const scroller = screen.getByTestId( 'scroller' );

		setScrollMetrics( scroller, { scrollHeight: 1000, clientHeight: 500, scrollTop: 500 } );
		fireEvent.scroll( scroller );

		expect( getButton() ).toHaveAttribute( 'data-visible', 'false' );
	} );

	it( 'appears when the user scrolls up and hides again at the bottom', () => {
		render( <Harness /> );
		const scroller = screen.getByTestId( 'scroller' );

		setScrollMetrics( scroller, { scrollHeight: 1000, clientHeight: 500, scrollTop: 100 } );
		fireEvent.scroll( scroller );
		expect( getButton() ).toHaveAttribute( 'data-visible', 'true' );

		scroller.scrollTop = 500;
		fireEvent.scroll( scroller );
		expect( getButton() ).toHaveAttribute( 'data-visible', 'false' );
	} );

	it( 'scrolls to the bottom on click, jumping most of a long distance first', () => {
		render( <Harness /> );
		const scroller = screen.getByTestId( 'scroller' );
		const scrollTo = vi.fn();
		Object.defineProperty( scroller, 'scrollTo', { value: scrollTo, configurable: true } );

		setScrollMetrics( scroller, { scrollHeight: 5000, clientHeight: 500, scrollTop: 0 } );
		fireEvent.scroll( scroller );
		expect( getButton() ).toHaveAttribute( 'data-visible', 'true' );

		fireEvent.click( getButton() );

		// Far from the bottom: jump so only two viewports remain, then glide.
		expect( scroller.scrollTop ).toBe( 3500 );
		expect( scrollTo ).toHaveBeenCalledWith( { top: 5000, behavior: 'smooth' } );

		// Once the smooth scroll lands at the bottom, the button hides.
		scroller.scrollTop = 4500;
		fireEvent.scroll( scroller );
		expect( getButton() ).toHaveAttribute( 'data-visible', 'false' );
	} );

	it( 'shows a tooltip on hover', async () => {
		render( <Harness /> );
		const scroller = screen.getByTestId( 'scroller' );

		setScrollMetrics( scroller, { scrollHeight: 1000, clientHeight: 500, scrollTop: 100 } );
		fireEvent.scroll( scroller );

		fireEvent.pointerEnter( getButton() );
		fireEvent.mouseEnter( getButton() );
		expect( await screen.findByText( 'Scroll to bottom' ) ).toBeInTheDocument();
	} );

	it( 'scrolls a short distance without the instant jump', () => {
		render( <Harness /> );
		const scroller = screen.getByTestId( 'scroller' );
		const scrollTo = vi.fn();
		Object.defineProperty( scroller, 'scrollTo', { value: scrollTo, configurable: true } );

		setScrollMetrics( scroller, { scrollHeight: 1000, clientHeight: 500, scrollTop: 200 } );
		fireEvent.scroll( scroller );

		fireEvent.click( getButton() );

		expect( scroller.scrollTop ).toBe( 200 );
		expect( scrollTo ).toHaveBeenCalledWith( { top: 1000, behavior: 'smooth' } );
	} );
} );
