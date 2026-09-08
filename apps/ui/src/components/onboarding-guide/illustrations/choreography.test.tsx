import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTimeline, type Playback } from './choreography';

// Drives the rAF clock by hand so a scene's whole run fits in a test.
function mockRaf() {
	const callbacks: FrameRequestCallback[] = [];
	vi.spyOn( window, 'requestAnimationFrame' ).mockImplementation( ( cb ) => {
		callbacks.push( cb );
		return callbacks.length;
	} );
	vi.spyOn( window, 'cancelAnimationFrame' ).mockImplementation( () => {} );
	return {
		// Flush one frame at `now`, letting the scene queue its next one.
		frame( now: number ) {
			const pending = callbacks.splice( 0, callbacks.length );
			act( () => pending.forEach( ( cb ) => cb( now ) ) );
		},
	};
}

function mockReducedMotion( reduce: boolean ) {
	vi.spyOn( window, 'matchMedia' ).mockImplementation(
		( query ) => ( { matches: reduce, media: query } ) as MediaQueryList
	);
}

function Scene( { playback }: { playback: Playback } ) {
	const { t } = useTimeline( { duration: 1000, loop: false, playback } );
	return <span data-testid="t">{ Math.round( t ) }</span>;
}

describe( 'useTimeline', () => {
	afterEach( () => {
		vi.restoreAllMocks();
	} );

	// The host advances its carousel on `onEnd`; firing it twice skips a slide.
	it( 'reports the end of a one-shot only once, across a pause', () => {
		mockReducedMotion( false );
		const raf = mockRaf();
		const onEnd = vi.fn();

		const { rerender } = render( <Scene playback={ { paused: false, onEnd } } /> );
		raf.frame( 100 );
		raf.frame( 2000 );
		expect( onEnd ).toHaveBeenCalledTimes( 1 );

		// Pausing and resuming re-runs the effect with the clock still past the
		// end; it must not report a second ending.
		rerender( <Scene playback={ { paused: true, onEnd } } /> );
		rerender( <Scene playback={ { paused: false, onEnd } } /> );
		raf.frame( 2100 );
		raf.frame( 2200 );

		expect( onEnd ).toHaveBeenCalledTimes( 1 );
	} );

	// Reduced motion plays no frames, so without a hold the host that advances
	// on `onEnd` would sit on its first slide forever.
	it( 'still reports an end under reduced motion, after the hold', () => {
		vi.useFakeTimers();
		mockReducedMotion( true );
		const onEnd = vi.fn();

		render( <Scene playback={ { onEnd, reducedMotionHoldMs: 9000 } } /> );

		expect( onEnd ).not.toHaveBeenCalled();

		act( () => {
			vi.advanceTimersByTime( 9000 );
		} );

		expect( onEnd ).toHaveBeenCalledTimes( 1 );
		vi.useRealTimers();
	} );

	it( 'does not advance a paused scene under reduced motion', () => {
		vi.useFakeTimers();
		mockReducedMotion( true );
		const onEnd = vi.fn();

		render( <Scene playback={ { paused: true, onEnd, reducedMotionHoldMs: 9000 } } /> );

		act( () => {
			vi.advanceTimersByTime( 30000 );
		} );

		expect( onEnd ).not.toHaveBeenCalled();
		vi.useRealTimers();
	} );

	// Scrubbing back from the end has to re-arm the ending, or the slide runs
	// out its remaining time without ever handing over.
	it( 'reports the end again after seeking back from a finished run', () => {
		mockReducedMotion( false );
		const raf = mockRaf();
		const onEnd = vi.fn();
		const playback = ( seek?: { to: number; key: number } ): Playback => ( { onEnd, seek } );

		const { rerender } = render( <Scene playback={ playback() } /> );
		raf.frame( 100 );
		raf.frame( 2000 );
		expect( onEnd ).toHaveBeenCalledTimes( 1 );

		rerender( <Scene playback={ playback( { to: 0.5, key: 1 } ) } /> );
		raf.frame( 3000 );
		raf.frame( 5000 );

		expect( onEnd ).toHaveBeenCalledTimes( 2 );
	} );
} );
