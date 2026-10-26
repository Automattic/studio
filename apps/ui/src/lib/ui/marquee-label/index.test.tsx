import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarqueeLabel } from './index';

let viewportWidth = 0;
let resize: () => void = () => {};
const animate = vi.fn( () => ( { cancel: vi.fn(), onfinish: null } ) );

beforeEach( () => {
	vi.useFakeTimers();
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
	vi.spyOn( window, 'matchMedia' ).mockImplementation(
		( query ) =>
			( {
				matches: ! query.includes( 'reduced-motion' ),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			} ) as unknown as MediaQueryList
	);
	vi.spyOn( HTMLElement.prototype, 'clientWidth', 'get' ).mockImplementation( () => viewportWidth );
	vi.spyOn( HTMLElement.prototype, 'scrollWidth', 'get' ).mockReturnValue( 160 );
	Object.defineProperty( HTMLElement.prototype, 'animate', { configurable: true, value: animate } );
} );

afterEach( () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	delete ( HTMLElement.prototype as Partial< HTMLElement > ).animate;
	vi.useRealTimers();
} );

it( 'scrolls an overflowing label on hover only once its row has a width', () => {
	render(
		<button data-slot="tabs-trigger">
			<MarqueeLabel>A long label</MarqueeLabel>
		</button>
	);
	viewportWidth = 0;
	fireEvent.mouseEnter( screen.getByRole( 'button' ) );
	act( () => {
		vi.advanceTimersByTime( 600 );
	} );
	expect( animate ).not.toHaveBeenCalled();

	viewportWidth = 100;
	act( () => {
		resize();
		vi.advanceTimersByTime( 600 );
	} );
	expect( animate ).toHaveBeenCalledTimes( 1 );
} );
