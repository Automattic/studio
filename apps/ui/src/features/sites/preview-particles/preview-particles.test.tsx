import { render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PreviewParticles } from './index';

afterEach( () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
} );

it.each( [ false, true ] )(
	'starts the resting grid continuously with showLogo=%s',
	( showLogo ) => {
		vi.stubGlobal( 'CanvasRenderingContext2D', class {} );
		vi.spyOn( HTMLElement.prototype, 'clientWidth', 'get' ).mockReturnValue( 800 );
		vi.spyOn( HTMLElement.prototype, 'clientHeight', 'get' ).mockReturnValue( 600 );
		let now = 0;
		let nextFrame: FrameRequestCallback;
		vi.spyOn( performance, 'now' ).mockImplementation( () => now );
		vi.spyOn( window, 'requestAnimationFrame' ).mockImplementation( ( callback ) => {
			nextFrame = callback;
			return 1;
		} );
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
		const positions = [ ...context.arc.mock.calls ];
		const opacity = context.globalAlpha;
		context.arc.mockClear();
		view.rerender(
			<div>
				<PreviewParticles active showLogo={ showLogo } />
			</div>
		);
		expect( context.setTransform ).toHaveBeenCalledOnce();
		expect( context.arc.mock.calls ).toEqual( positions );
		expect( context.globalAlpha ).toBe( opacity );

		context.arc.mockClear();
		now = 64;
		nextFrame!( now );
		const movingPositions = [ ...context.arc.mock.calls ];
		expect( movingPositions ).not.toEqual( positions );
		for ( const active of [ false, true, false ] ) {
			context.arc.mockClear();
			view.rerender(
				<div>
					<PreviewParticles active={ active } showLogo={ active && showLogo } />
				</div>
			);
			expect( context.arc.mock.calls ).toEqual( movingPositions );
		}
		context.arc.mockClear();
		now += 64;
		nextFrame!( now );
		expect( context.arc.mock.calls ).toEqual( positions );
		expect( context.globalAlpha ).toBe( opacity );
		expect( context.setTransform ).toHaveBeenCalledOnce();
	}
);
