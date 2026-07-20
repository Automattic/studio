import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DotGrid } from '.';

const canvasContext = {
	clearRect: vi.fn(),
	fillRect: vi.fn(),
	beginPath: vi.fn(),
	moveTo: vi.fn(),
	lineTo: vi.fn(),
	stroke: vi.fn(),
	scale: vi.fn(),
	setLineDash: vi.fn(),
	fillStyle: '',
	strokeStyle: '',
	lineWidth: 0,
	globalAlpha: 1,
};

class ResizeObserverMock {
	observe = vi.fn();
	disconnect = vi.fn();
}

beforeEach( () => {
	vi.spyOn( HTMLCanvasElement.prototype, 'getContext' ).mockImplementation(
		() => canvasContext as unknown as CanvasRenderingContext2D
	);
	vi.stubGlobal( 'ResizeObserver', ResizeObserverMock );
	vi.stubGlobal(
		'matchMedia',
		vi.fn().mockImplementation( ( query: string ) => ( {
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		} ) )
	);
	vi.stubGlobal(
		'requestAnimationFrame',
		vi.fn( () => 1 )
	);
	vi.stubGlobal( 'cancelAnimationFrame', vi.fn() );
} );

afterEach( () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
} );

describe( 'DotGrid', () => {
	it( 'renders a canvas element', () => {
		const { container } = render( <DotGrid /> );

		expect( container.querySelector( 'canvas' ) ).toBeInTheDocument();
	} );

	it( 'applies custom className', () => {
		const { container } = render( <DotGrid className="custom-grid" /> );

		expect( container.querySelector( 'canvas' ) ).toHaveClass( 'custom-grid' );
	} );

	it( 'applies opacity via style', () => {
		const { container } = render( <DotGrid opacity={ 0.5 } /> );

		expect( container.querySelector( 'canvas' ) ).toHaveStyle( { opacity: '0.5' } );
	} );

	it( 'renders while inactive', () => {
		const { container } = render( <DotGrid active={ false } /> );

		expect( container.querySelector( 'canvas' ) ).toBeInTheDocument();
	} );
} );
