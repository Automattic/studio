import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarqueeLabel } from './index';

let width = 100;
let textWidth = 160;
let resize: () => void;
let reduced = false;
let hover = true;
let motionChange: () => void;
const cancel = vi.fn();
const animate = vi.fn();

beforeEach( () => {
	vi.useFakeTimers();
	width = 100;
	textWidth = 160;
	reduced = false;
	hover = true;
	cancel.mockReset();
	animate.mockReset().mockReturnValue( { cancel, onfinish: null } );
	vi.stubGlobal(
		'ResizeObserver',
		class {
			constructor( callback: () => void ) {
				resize = callback;
			}
			observe() {}
			disconnect() {}
		}
	);
	vi.spyOn( window, 'matchMedia' ).mockImplementation( ( query ) => ( {
		get matches() {
			return query.includes( 'reduced-motion' ) ? reduced : hover;
		},
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: ( _event: string, callback: EventListenerOrEventListenerObject ) => {
			if ( query.includes( 'reduced-motion' ) ) {
				motionChange = callback as () => void;
			}
		},
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	} ) );
	vi.spyOn( HTMLElement.prototype, 'clientWidth', 'get' ).mockImplementation( () => width );
	vi.spyOn( HTMLElement.prototype, 'scrollWidth', 'get' ).mockImplementation( () => textWidth );
	Object.defineProperty( HTMLElement.prototype, 'animate', { configurable: true, value: animate } );
} );

afterEach( () => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	delete ( HTMLElement.prototype as Partial< HTMLElement > ).animate;
	vi.useRealTimers();
} );

function setup( attributes: Record< string, string | undefined > = {} ) {
	const view = render(
		<button data-slot="tabs-trigger" { ...attributes }>
			<MarqueeLabel>A long label</MarqueeLabel>
			<span>Fixed badge</span>
		</button>
	);
	return { ...view, row: view.getByRole( 'button' ) };
}

function focusVisible( row: HTMLElement, isFocused: () => boolean = () => true ) {
	const matches = row.matches.bind( row );
	vi.spyOn( row, 'matches' ).mockImplementation( ( selector ) =>
		selector === ':focus-visible' ? isFocused() : matches( selector )
	);
}

it( 'waits 600ms, reveals the measured overflow, pauses and returns once', async () => {
	const { row } = setup();
	fireEvent.mouseEnter( row );
	await act( () => vi.advanceTimersByTime( 599 ) );
	expect( animate ).not.toHaveBeenCalled();
	await act( () => vi.advanceTimersByTime( 1 ) );
	expect( animate.mock.calls[ 0 ][ 0 ] ).toContainEqual(
		expect.objectContaining( { transform: 'translateX(-60px)' } )
	);
	await act( () => animate.mock.results[ 0 ].value.onfinish() );
	await act( () => {
		resize();
		vi.advanceTimersByTime( 10000 );
	} );
	expect( animate ).toHaveBeenCalledTimes( 1 );
	fireEvent.mouseLeave( row );
	fireEvent.mouseEnter( row );
	await act( () => vi.advanceTimersByTime( 600 ) );
	expect( animate ).toHaveBeenCalledTimes( 2 );
} );

it( 'scrolls on hover only once its row has a width', async () => {
	width = 0;
	const { row } = setup();
	fireEvent.mouseEnter( row );
	await act( () => vi.advanceTimersByTime( 600 ) );
	expect( animate ).not.toHaveBeenCalled();
	width = 100;
	await act( () => {
		resize();
		vi.advanceTimersByTime( 600 );
	} );
	expect( animate ).toHaveBeenCalledOnce();
} );

it( 'animates highlighted Settings results and keyboard-focused tabs', async () => {
	const view = setup( { 'data-highlighted': '' } );
	await act( () => vi.advanceTimersByTime( 600 ) );
	expect( animate ).toHaveBeenCalledTimes( 1 );
	view.unmount();
	const { row } = setup();
	focusVisible( row );
	fireEvent.focusIn( row );
	await act( () => vi.advanceTimersByTime( 600 ) );
	expect( animate ).toHaveBeenCalledTimes( 2 );
} );

it( 'cancels on leaving, resize, disabled state and unmount', async () => {
	const view = setup();
	fireEvent.mouseEnter( view.row );
	fireEvent.mouseLeave( view.row );
	await act( () => vi.advanceTimersByTime( 600 ) );
	expect( animate ).not.toHaveBeenCalled();
	fireEvent.mouseEnter( view.row );
	await act( () => vi.advanceTimersByTime( 600 ) );
	width = 120;
	await act( () => resize() );
	expect( cancel ).toHaveBeenCalledTimes( 1 );
	fireEvent.mouseLeave( view.row );
	fireEvent.mouseEnter( view.row );
	await act( () => vi.advanceTimersByTime( 600 ) );
	await act( async () => {
		view.row.setAttribute( 'disabled', '' );
	} );
	expect( cancel ).toHaveBeenCalledTimes( 2 );
	await act( async () => {
		view.row.removeAttribute( 'disabled' );
	} );
	await act( () => vi.advanceTimersByTime( 600 ) );
	view.unmount();
	expect( cancel ).toHaveBeenCalledTimes( 3 );
} );

it( 'keeps fitting and reduced-motion labels static', async () => {
	const { row } = setup();
	fireEvent.mouseEnter( row );
	width = 160;
	await act( () => {
		resize();
		vi.advanceTimersByTime( 600 );
	} );
	expect( animate ).not.toHaveBeenCalled();
	width = 100;
	reduced = true;
	await act( () => {
		motionChange();
		vi.advanceTimersByTime( 600 );
	} );
	expect( animate ).not.toHaveBeenCalled();
	reduced = false;
	await act( () => {
		motionChange();
		vi.advanceTimersByTime( 600 );
	} );
	expect( animate ).toHaveBeenCalledTimes( 1 );
	reduced = true;
	await act( () => motionChange() );
	expect( cancel ).toHaveBeenCalledOnce();
	expect( row ).toHaveAccessibleName( 'A long label Fixed badge' );
} );

it( 'ignores coarse-pointer hover', async () => {
	hover = false;
	const { row } = setup();
	fireEvent.mouseEnter( row );
	await act( () => vi.advanceTimersByTime( 600 ) );
	expect( animate ).not.toHaveBeenCalled();
} );

it( 'cancels after keyboard focus leaves and clears pending work on unmount', async () => {
	const { row, unmount } = setup();
	let focused = true;
	focusVisible( row, () => focused );
	fireEvent.focusIn( row );
	await act( () => vi.advanceTimersByTime( 600 ) );
	fireEvent.focusOut( row );
	focused = false;
	await act( () => vi.runAllTicks() );
	expect( cancel ).toHaveBeenCalledOnce();
	fireEvent.focusIn( row );
	fireEvent.focusOut( row );
	unmount();
	await act( () => {
		vi.runAllTicks();
		vi.advanceTimersByTime( 600 );
	} );
	expect( animate ).toHaveBeenCalledOnce();
} );
