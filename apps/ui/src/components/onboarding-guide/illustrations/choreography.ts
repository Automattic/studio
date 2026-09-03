import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

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

// External control over a scene's clock, for hosts that own the transport
// (a carousel with its own replay/pause and a progress ring).
export interface Playback {
	/** Freeze the clock where it is; resume continues from there. */
	paused?: boolean;
	/** Bump to restart from zero. */
	restartKey?: number;
	/** Jump to a point (0→1) through `duration`; bump `key` to apply again. */
	seek?: { to: number; key: number };
	/** Called every frame with 0→1 progress through `duration`. */
	onProgress?: ( progress: number ) => void;
	/** Called once when a one-shot timeline reaches its end. */
	onEnd?: () => void;
}

// A single requestAnimationFrame clock. Reduced motion skips the animation and
// rests on a representative frame — the start of a loop, or the end of a
// one-shot (its finished state).
export function useTimeline( {
	duration,
	loop = false,
	playback,
}: {
	duration: number;
	loop?: boolean;
	playback?: Playback;
} ): Timeline {
	const [ t, setT ] = useState( () => ( ! loop && prefersReducedMotion() ? duration : 0 ) );
	const [ nonce, setNonce ] = useState( 0 );
	const rafRef = useRef( 0 );
	// Elapsed time survives a pause so resuming picks up where it stopped.
	const elapsedRef = useRef( 0 );
	const playbackRef = useRef( playback );
	useLayoutEffect( () => {
		playbackRef.current = playback;
	} );
	const paused = playback?.paused ?? false;
	const restartKey = playback?.restartKey ?? 0;
	const seekKey = playback?.seek?.key ?? 0;

	const restart = useCallback( () => {
		elapsedRef.current = 0;
		setNonce( ( n ) => n + 1 );
	}, [] );

	useEffect( () => {
		elapsedRef.current = 0;
	}, [ restartKey ] );

	// A seek only applies when it changes after mount, so a freshly mounted
	// scene starts from zero even if the host still holds an older seek.
	const appliedSeekRef = useRef( seekKey );
	useEffect( () => {
		if ( appliedSeekRef.current === seekKey ) {
			return;
		}
		appliedSeekRef.current = seekKey;
		const seek = playbackRef.current?.seek;
		if ( seek ) {
			elapsedRef.current = Math.min( 0.999, Math.max( 0, seek.to ) ) * duration;
		}
	}, [ seekKey, duration ] );

	useEffect( () => {
		if ( prefersReducedMotion() ) {
			setT( loop ? 0 : duration );
			playbackRef.current?.onProgress?.( loop ? 0 : 1 );
			return;
		}
		if ( paused ) {
			// Hold the current frame — including one just scrubbed to.
			const held = loop ? elapsedRef.current % duration : Math.min( elapsedRef.current, duration );
			setT( held );
			playbackRef.current?.onProgress?.( Math.min( 1, held / duration ) );
			return;
		}
		const offset = elapsedRef.current;
		let start = 0;
		const tick = ( now: number ) => {
			if ( ! start ) {
				start = now;
			}
			const elapsed = offset + ( now - start );
			elapsedRef.current = elapsed;
			const next = loop ? elapsed % duration : Math.min( elapsed, duration );
			setT( next );
			playbackRef.current?.onProgress?.( Math.min( 1, next / duration ) );
			if ( loop || elapsed < duration ) {
				rafRef.current = requestAnimationFrame( tick );
			} else {
				playbackRef.current?.onEnd?.();
			}
		};
		rafRef.current = requestAnimationFrame( tick );
		return () => cancelAnimationFrame( rafRef.current );
	}, [ duration, loop, nonce, restartKey, seekKey, paused ] );

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
