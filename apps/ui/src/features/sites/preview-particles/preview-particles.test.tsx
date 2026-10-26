import { render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PreviewParticles } from './index';

afterEach( () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
} );

it( 'starts moving the resting dots without rebuilding the canvas', () => {
	vi.stubGlobal( 'CanvasRenderingContext2D', class {} );
	vi.spyOn( HTMLElement.prototype, 'clientWidth', 'get' ).mockReturnValue( 800 );
	vi.spyOn( HTMLElement.prototype, 'clientHeight', 'get' ).mockReturnValue( 600 );
	vi.spyOn( window, 'requestAnimationFrame' ).mockReturnValue( 1 );
	const context = {
		clearRect: vi.fn(),
		setTransform: vi.fn(),
		beginPath: vi.fn(),
		arc: vi.fn(),
		fill: vi.fn(),
		fillStyle: '',
		globalAlpha: 1,
	};
	vi.spyOn( HTMLCanvasElement.prototype, 'getContext' ).mockReturnValue(
		context as unknown as CanvasRenderingContext2D
	);
	const view = render(
		<div>
			<PreviewParticles />
		</div>
	);
	const position = context.arc.mock.calls[ 0 ];
	const opacity = context.globalAlpha;
	context.arc.mockClear();
	view.rerender(
		<div>
			<PreviewParticles active />
		</div>
	);
	expect( context.setTransform ).toHaveBeenCalledOnce();
	expect( context.arc.mock.calls[ 0 ] ).toEqual( position );
	expect( context.globalAlpha ).toBe( opacity );
} );
