import { useCallback, useEffect, useRef, useState } from 'react';

// The choreography system for the onboarding illustrations. Every scene runs on
// one clock: `useTimeline` exposes elapsed time `t` (ms), and the pure helpers
// below turn `t` into styles. Loops and one-shots, reduced motion, and replay
// are all handled here so scenes only declare *what* happens *when*.

export type Easing = ( p: number ) => number;

export const easings = {
	linear: ( p: number ) => p,
	easeIn: ( p: number ) => p * p * p,
	easeOut: ( p: number ) => 1 - Math.pow( 1 - p, 3 ),
	easeInOut: ( p: number ) => ( p < 0.5 ? 4 * p * p * p : 1 - Math.pow( -2 * p + 2, 3 ) / 2 ),
};

function prefersReducedMotion(): boolean {
	return (
		typeof window !== 'undefined' &&
		Boolean( window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches )
	);
}

export interface Timeline {
	/** Elapsed milliseconds: wraps at `duration` when looping, clamps otherwise. */
	t: number;
	/** Restart from zero (used by one-shot scenes' Replay control). */
	restart: () => void;
}

// A single requestAnimationFrame clock. Reduced motion skips the animation and
// rests on a representative frame — the start of a loop, or the end of a
// one-shot (its finished state).
export function useTimeline( {
	duration,
	loop = false,
}: {
	duration: number;
	loop?: boolean;
} ): Timeline {
	const [ t, setT ] = useState( () => ( ! loop && prefersReducedMotion() ? duration : 0 ) );
	const [ nonce, setNonce ] = useState( 0 );
	const rafRef = useRef( 0 );

	const restart = useCallback( () => setNonce( ( n ) => n + 1 ), [] );

	useEffect( () => {
		if ( prefersReducedMotion() ) {
			setT( loop ? 0 : duration );
			return;
		}
		let start = 0;
		const tick = ( now: number ) => {
			if ( ! start ) {
				start = now;
			}
			const elapsed = now - start;
			setT( loop ? elapsed % duration : Math.min( elapsed, duration ) );
			if ( loop || elapsed < duration ) {
				rafRef.current = requestAnimationFrame( tick );
			}
		};
		rafRef.current = requestAnimationFrame( tick );
		return () => cancelAnimationFrame( rafRef.current );
	}, [ duration, loop, nonce ] );

	return { t, restart };
}

// Has the clock passed a cue mark?
export function at( t: number, mark: number ): boolean {
	return t >= mark;
}

// Eased 0→1 progress across a window (before → 0, after → 1).
export function span(
	t: number,
	from: number,
	to: number,
	easing: Easing = easings.easeInOut
): number {
	if ( t <= from ) {
		return 0;
	}
	if ( t >= to ) {
		return 1;
	}
	return easing( ( t - from ) / ( to - from ) );
}

// Opacity envelope: fade in over `inDur` at `inAt`, hold, then (optionally) fade
// out over `outDur` at `outAt`. Returns 0→1.
export function envelope(
	t: number,
	inAt: number,
	inDur: number,
	outAt = Infinity,
	outDur = 0
): number {
	if ( t < inAt ) {
		return 0;
	}
	if ( t < inAt + inDur ) {
		return ( t - inAt ) / inDur;
	}
	if ( t < outAt ) {
		return 1;
	}
	if ( t < outAt + outDur ) {
		return 1 - ( t - outAt ) / outDur;
	}
	return 0;
}

export interface Keyframe {
	/** Time (ms) of this keyframe. */
	at: number;
	/** Easing for the segment starting at this keyframe. */
	ease?: Easing;
	[ prop: string ]: number | Easing | undefined;
}

// Interpolates numeric properties across keyframes at time `t`. Any numeric key
// present on the frames (x, y, scale, opacity, …) is tweened; the segment uses
// the starting frame's `ease` (default easeInOut). Frames must be ordered by
// `at`.
export function sample( t: number, frames: Keyframe[] ): Record< string, number > {
	const readNumbers = ( frame: Keyframe ): Record< string, number > => {
		const out: Record< string, number > = {};
		for ( const key of Object.keys( frame ) ) {
			if ( key === 'at' || key === 'ease' ) {
				continue;
			}
			const value = frame[ key ];
			if ( typeof value === 'number' ) {
				out[ key ] = value;
			}
		}
		return out;
	};

	if ( t <= frames[ 0 ].at ) {
		return readNumbers( frames[ 0 ] );
	}
	const last = frames[ frames.length - 1 ];
	if ( t >= last.at ) {
		return readNumbers( last );
	}

	let i = 0;
	while ( i < frames.length - 1 && t > frames[ i + 1 ].at ) {
		i++;
	}
	const a = frames[ i ];
	const b = frames[ i + 1 ];
	const ease = a.ease ?? easings.easeInOut;
	const p = ease( ( t - a.at ) / ( b.at - a.at ) );

	const from = readNumbers( a );
	const to = readNumbers( b );
	const out: Record< string, number > = {};
	for ( const key of Object.keys( from ) ) {
		const av = from[ key ];
		const bv = to[ key ] ?? av;
		out[ key ] = av + ( bv - av ) * p;
	}
	return out;
}
