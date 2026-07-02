import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

// How close (in px) to the bottom edge still counts as "at the bottom".
// Keeps the stick engaged through sub-pixel rounding and tiny wheel nudges.
const AT_BOTTOM_THRESHOLD_PX = 48;

function isNodeAtBottom( node: HTMLElement ): boolean {
	return node.scrollHeight - ( node.scrollTop + node.clientHeight ) <= AT_BOTTOM_THRESHOLD_PX;
}

/**
 * Tracks whether the conversation scroller is pinned to its bottom edge.
 *
 * There is no need to tell user scrolls apart from programmatic ones: the
 * auto-scroll layout effect writes `scrollTop` before paint, so while stuck
 * the position never leaves the bottom and the flag stays true. When the user
 * scrolls up the flag flips false (pausing auto-scroll), and scrolling back
 * down — manually or via `scrollToBottom` — re-engages it.
 */
export function useStickToBottom( scrollRef: RefObject< HTMLElement | null >, sessionId: string ) {
	const [ isAtBottom, setIsAtBottom ] = useState( true );
	const isAtBottomRef = useRef( true );

	useEffect( () => {
		const node = scrollRef.current;
		if ( ! node ) {
			return;
		}
		const update = () => {
			const atBottom = isNodeAtBottom( node );
			isAtBottomRef.current = atBottom;
			setIsAtBottom( atBottom );
		};
		update();
		node.addEventListener( 'scroll', update, { passive: true } );
		return () => node.removeEventListener( 'scroll', update );
	}, [ scrollRef, sessionId ] );

	const scrollToBottom = useCallback( () => {
		const node = scrollRef.current;
		if ( ! node ) {
			return;
		}
		if ( window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches ) {
			node.scrollTop = node.scrollHeight;
			return;
		}
		// Keep the glide quick on very long conversations: jump most of the
		// way instantly and only smooth-scroll the last two viewports.
		const distance = node.scrollHeight - ( node.scrollTop + node.clientHeight );
		if ( distance > node.clientHeight * 2 ) {
			node.scrollTop = node.scrollHeight - node.clientHeight * 3;
		}
		node.scrollTo( { top: node.scrollHeight, behavior: 'smooth' } );
	}, [ scrollRef ] );

	return { isAtBottom, isAtBottomRef, scrollToBottom };
}
