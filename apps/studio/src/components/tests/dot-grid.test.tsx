import { render } from '@testing-library/react';
import { DotGrid } from 'src/components/dot-grid';

// jsdom doesn't support canvas getContext — stub it
beforeEach( () => {
	HTMLCanvasElement.prototype.getContext = vi.fn( () => ( {
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
	} ) ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
} );

describe( 'DotGrid', () => {
	test( 'renders a canvas element', () => {
		const { container } = render( <DotGrid /> );
		const canvas = container.querySelector( 'canvas' );
		expect( canvas ).toBeInTheDocument();
	} );

	test( 'applies custom className', () => {
		const { container } = render( <DotGrid className="text-red-500" /> );
		const canvas = container.querySelector( 'canvas' );
		expect( canvas ).toHaveClass( 'text-red-500' );
	} );

	test( 'applies opacity via style', () => {
		const { container } = render( <DotGrid opacity={ 0.5 } /> );
		const canvas = container.querySelector( 'canvas' );
		expect( canvas ).toHaveStyle( { opacity: '0.5' } );
	} );
} );
