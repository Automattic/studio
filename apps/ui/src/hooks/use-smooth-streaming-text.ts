import { useEffect, useRef, useState } from 'react';

// How far the shown text trails the received text. Deltas arrive in bursts
// (token batching, proxy buffering); draining each burst over this window
// turns it into an even flow without letting the display fall behind.
const LIVE_LAG_SECONDS = 0.35;
// Once the reply has ended there is nothing left to smooth against, so the
// remainder empties quickly instead of trailing the finished message.
const FINISHED_LAG_SECONDS = 0.12;
const MIN_CHARS_PER_SECOND = 40;
const MAX_CHARS_PER_SECOND = 4000;
// A hidden tab pauses animation frames; cap one frame's catch-up so the first
// frame back doesn't dump everything at once.
const MAX_FRAME_SECONDS = 0.1;
// Past this many characters without whitespace (a URL, a code identifier) the
// reveal stops waiting for a word boundary rather than stalling.
const LONG_TOKEN_CHARS = 24;

export interface RevealState {
	// Characters of the target currently shown.
	visible: number;
	// Fractional character budget carried between frames.
	pending: number;
}

function isWhitespace( char: string ): boolean {
	return char === ' ' || char === '\n' || char === '\t' || char === '\r';
}

// Largest index in (from, to] that sits right before a whitespace character,
// or `from` when there is none.
function lastWordBoundary( text: string, from: number, to: number ): number {
	for ( let index = to; index > from; index -= 1 ) {
		if ( index < text.length && isWhitespace( text[ index ] ) ) {
			return index;
		}
	}
	return from;
}

export function advanceReveal(
	state: RevealState,
	target: string,
	dtSeconds: number,
	isLive: boolean
): RevealState {
	const backlog = target.length - state.visible;
	if ( backlog <= 0 ) {
		return { visible: target.length, pending: 0 };
	}
	const lag = isLive ? LIVE_LAG_SECONDS : FINISHED_LAG_SECONDS;
	const rate = Math.min( MAX_CHARS_PER_SECOND, Math.max( MIN_CHARS_PER_SECOND, backlog / lag ) );
	const dt = Math.min( Math.max( dtSeconds, 0 ), MAX_FRAME_SECONDS );
	const pending = state.pending + rate * dt;
	const candidate = Math.min( target.length, state.visible + Math.floor( pending ) );

	let cut = candidate;
	// While live, stop before whitespace: a half-typed word can wrap onto the
	// next line and jump back when the rest of it lands. A finished reply is
	// final text, so its tail just drains.
	if ( isLive ) {
		const boundary = lastWordBoundary( target, state.visible, candidate );
		if ( boundary > state.visible ) {
			cut = boundary;
		} else if ( candidate - state.visible < LONG_TOKEN_CHARS ) {
			return { visible: state.visible, pending: Math.min( pending, LONG_TOKEN_CHARS ) };
		}
	}
	return {
		visible: cut,
		pending: cut === target.length ? 0 : pending - ( cut - state.visible ),
	};
}

function prefersReducedMotion(): boolean {
	return window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches ?? false;
}

/**
 * Meter a streaming text block onto the screen at an even pace. `text` is the
 * latest received content; while `isLive` the visible portion chases it at
 * word boundaries, and once the reply ends the remainder drains quickly.
 * Text that mounts finished (history) shows whole and never animates.
 */
export function useSmoothStreamingText( text: string, isLive: boolean ): string {
	const [ reduceMotion ] = useState( prefersReducedMotion );
	const [ visible, setVisible ] = useState( () => ( isLive ? 0 : text.length ) );
	const [ previousText, setPreviousText ] = useState( text );
	if ( text !== previousText ) {
		setPreviousText( text );
		// The post-run refetch can re-key this row to a different message; show
		// that one whole instead of replaying it.
		if ( ! isLive && ! text.startsWith( previousText.slice( 0, visible ) ) ) {
			setVisible( text.length );
		}
	}

	const stateRef = useRef< RevealState >( { visible, pending: 0 } );
	const targetRef = useRef( text );
	const liveRef = useRef( isLive );
	const frameRef = useRef( 0 );
	const lastFrameRef = useRef( 0 );

	useEffect( () => {
		targetRef.current = text;
		liveRef.current = isLive;
		if ( stateRef.current.visible < visible ) {
			stateRef.current = { visible, pending: 0 };
		}
		if ( reduceMotion || frameRef.current || stateRef.current.visible >= text.length ) {
			return;
		}
		lastFrameRef.current = performance.now();
		const tick = ( now: number ) => {
			const next = advanceReveal(
				stateRef.current,
				targetRef.current,
				( now - lastFrameRef.current ) / 1000,
				liveRef.current
			);
			lastFrameRef.current = now;
			stateRef.current = next;
			setVisible( next.visible );
			frameRef.current =
				next.visible < targetRef.current.length ? requestAnimationFrame( tick ) : 0;
		};
		frameRef.current = requestAnimationFrame( tick );
	}, [ isLive, reduceMotion, text, visible ] );

	useEffect( () => () => cancelAnimationFrame( frameRef.current ), [] );

	if ( reduceMotion || visible >= text.length ) {
		return text;
	}
	return text.slice( 0, visible );
}
