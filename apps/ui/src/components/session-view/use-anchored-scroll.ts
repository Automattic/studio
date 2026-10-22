import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Marks a transcript row that starts a turn: the user's prompts.
export const SCROLL_ANCHOR_ATTRIBUTE = 'data-scroll-anchor';

// Slack below the bottom edge that still counts as "at the latest message",
// so sub-pixel rounding or a barely-started scroll doesn't flash the button.
const SCROLL_AWAY_FROM_LATEST_THRESHOLD_PX = 48;

// How much of the previous message stays visible above a prompt at the top.
const ANCHOR_PEEK_PX = 24;

export function isScrolledAwayFromLatest( node: {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
} ): boolean {
	return (
		node.scrollHeight - node.scrollTop - node.clientHeight > SCROLL_AWAY_FROM_LATEST_THRESHOLD_PX
	);
}

// Kept outside the hook: the React Compiler lint reads a direct `scrollTop`
// store on a state-held node as a state mutation.
function scrollTo( node: HTMLElement, top: number ) {
	node.scrollTop = top;
}

function getLastAnchor( node: HTMLElement ) {
	const anchors = node.querySelectorAll< HTMLElement >( `[${ SCROLL_ANCHOR_ATTRIBUTE }]` );
	return { count: anchors.length, last: anchors[ anchors.length - 1 ] };
}

/**
 * Scrolls the transcript like a log anchored on the user's prompts. A chat
 * opens at its last prompt (or its end, when that turn fits). A new prompt
 * moves near the top, with a spacer below it so it can, and its reply streams
 * in underneath; once the reply fills the view, the view follows it. Scrolling
 * away stops the following until the user returns to the latest message.
 */
export function useAnchoredScroll( {
	scrollNode,
	sessionId,
	content,
	paused,
}: {
	scrollNode: HTMLElement | null;
	sessionId: string;
	// Changes whenever the transcript may have grown.
	content: unknown;
	// Holds the view still, e.g. while the agent waits on an answer.
	paused: boolean;
} ) {
	const spacerRef = useRef< HTMLDivElement >( null );
	const [ isScrolledAway, setIsScrolledAway ] = useState( false );
	const stateRef = useRef( { sessionId: '', anchors: 0, pinned: false, following: true } );

	const settle = useCallback( () => {
		const spacer = spacerRef.current;
		if ( ! scrollNode || ! spacer ) {
			return;
		}
		const state = stateRef.current;
		const { count, last } = getLastAnchor( scrollNode );
		const style = getComputedStyle( scrollNode );
		const insetTop = parseFloat( style.paddingTop ) || 0;
		const insetBottom = parseFloat( style.paddingBottom ) || 0;
		const anchorOffset = () =>
			last.getBoundingClientRect().top -
			scrollNode.getBoundingClientRect().top +
			scrollNode.scrollTop -
			insetTop -
			ANCHOR_PEEK_PX;

		if ( state.sessionId !== sessionId ) {
			stateRef.current = { sessionId, anchors: count, pinned: false, following: true };
			spacer.style.height = '0px';
			scrollTo( scrollNode, last ? anchorOffset() : scrollNode.scrollHeight );
			const away = isScrolledAwayFromLatest( scrollNode );
			stateRef.current.following = ! away;
			setIsScrolledAway( away );
			return;
		}

		if ( count > state.anchors ) {
			state.pinned = true;
			state.following = true;
			setIsScrolledAway( false );
		}
		state.anchors = count;
		if ( state.pinned && last ) {
			const tail = spacer.getBoundingClientRect().top - last.getBoundingClientRect().top;
			const room = scrollNode.clientHeight - insetTop - insetBottom - ANCHOR_PEEK_PX;
			spacer.style.height = `${ Math.max( 0, room - tail ) }px`;
		}
		if ( state.following && ! paused ) {
			scrollTo( scrollNode, scrollNode.scrollHeight );
		} else {
			setIsScrolledAway( isScrolledAwayFromLatest( scrollNode ) );
		}
	}, [ paused, scrollNode, sessionId ] );

	useEffect( () => {
		if ( ! scrollNode ) {
			return;
		}
		const onScroll = () => {
			const away = isScrolledAwayFromLatest( scrollNode );
			stateRef.current.following = ! away;
			setIsScrolledAway( away );
		};
		scrollNode.addEventListener( 'scroll', onScroll, { passive: true } );
		if ( typeof ResizeObserver === 'undefined' ) {
			return () => scrollNode.removeEventListener( 'scroll', onScroll );
		}
		// Late layout (images, highlighted code) and viewport resizes move the
		// anchor without a transcript change.
		const observer = new ResizeObserver( () => settle() );
		observer.observe( scrollNode );
		for ( const child of Array.from( scrollNode.children ) ) {
			if ( child !== spacerRef.current ) {
				observer.observe( child );
			}
		}
		return () => {
			scrollNode.removeEventListener( 'scroll', onScroll );
			observer.disconnect();
		};
	}, [ scrollNode, settle ] );

	useLayoutEffect( () => {
		settle();
	}, [ settle, content ] );

	const scrollToLatest = useCallback( () => {
		if ( ! scrollNode ) {
			return;
		}
		const prefersReducedMotion = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches;
		scrollNode.scrollTo( {
			top: scrollNode.scrollHeight,
			behavior: prefersReducedMotion ? 'auto' : 'smooth',
		} );
	}, [ scrollNode ] );

	return { spacerRef, isScrolledAway, scrollToLatest };
}
