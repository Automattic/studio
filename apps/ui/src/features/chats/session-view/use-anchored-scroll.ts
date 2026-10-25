import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Marks a transcript row that starts a turn: the user's prompts.
export const SCROLL_ANCHOR_ATTRIBUTE = 'data-scroll-anchor';

// Slack below the bottom edge that still counts as "at the latest message",
// so sub-pixel rounding or a barely-started scroll doesn't flash the button.
const SCROLL_AWAY_FROM_LATEST_THRESHOLD_PX = 8;

// How much of the previous message stays visible above a prompt at the top.
const ANCHOR_PEEK_PX = 64;

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

function getViewTop( node: HTMLElement, element: HTMLElement ) {
	return element.getBoundingClientRect().top - node.getBoundingClientRect().top;
}

/**
 * Scrolls the transcript like a log anchored on the user's prompts. A chat
 * opens at its last prompt (or its end, when that turn fits). A new prompt
 * moves near the top, with a spacer below it so it can, and its reply streams
 * in underneath; once the reply fills the view, the view follows it. Scrolling
 * away stops the following until the user returns to the latest message.
 * An opened chat holds its last prompt in place while late layout (images,
 * highlighted code) settles above it, until the user scrolls.
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
	const stateRef = useRef( {
		sessionId: '',
		anchors: 0,
		pinned: false,
		following: true,
		jumping: false,
		holding: false,
		heldTop: 0,
		heldAt: 0,
	} );

	const settle = useCallback( () => {
		const spacer = spacerRef.current;
		if ( ! scrollNode || ! spacer ) {
			return;
		}
		let state = stateRef.current;
		const { count, last } = getLastAnchor( scrollNode );
		const style = getComputedStyle( scrollNode );
		const insetTop = parseFloat( style.paddingTop ) || 0;
		const insetBottom = parseFloat( style.paddingBottom ) || 0;
		const anchorOffset = () =>
			getViewTop( scrollNode, last ) + scrollNode.scrollTop - insetTop - ANCHOR_PEEK_PX;

		if ( state.sessionId !== sessionId ) {
			state = stateRef.current = {
				sessionId,
				anchors: count,
				pinned: false,
				following: true,
				jumping: false,
				holding: !! last,
				heldTop: 0,
				heldAt: 0,
			};
			spacer.style.height = '0px';
		}
		if ( state.holding && last && count === state.anchors ) {
			scrollTo( scrollNode, anchorOffset() );
			state.heldTop = scrollNode.scrollTop;
			state.heldAt = getViewTop( scrollNode, last );
			const away = isScrolledAwayFromLatest( scrollNode );
			state.following = ! away;
			setIsScrolledAway( away );
			return;
		}
		state.holding = false;

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
			const state = stateRef.current;
			// Find in page or keyboard scrolling moves the view without the
			// events below, and the prompt moves with the scroll. Scroll anchoring
			// and late layout above it move one without the other.
			const scrolled = scrollNode.scrollTop - state.heldTop;
			if ( state.holding && Math.abs( scrolled ) > 1 ) {
				const { last } = getLastAnchor( scrollNode );
				const moved = last ? getViewTop( scrollNode, last ) - state.heldAt : 0;
				state.holding = Math.abs( moved + scrolled ) > 1;
			}
			// A jump keeps the button hidden while its smooth scroll is on the way.
			if ( state.jumping && away ) {
				return;
			}
			state.jumping = false;
			state.following = ! away;
			setIsScrolledAway( away );
		};
		const listening = new AbortController();
		const options = { passive: true, signal: listening.signal };
		scrollNode.addEventListener( 'scroll', onScroll, options );
		for ( const type of [ 'wheel', 'touchmove', 'keydown', 'pointerdown' ] ) {
			scrollNode.addEventListener(
				type,
				() => Object.assign( stateRef.current, { jumping: false, holding: false } ),
				options
			);
		}
		if ( typeof ResizeObserver === 'undefined' ) {
			return () => listening.abort();
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
			listening.abort();
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
		Object.assign( stateRef.current, { following: true, jumping: true, holding: false } );
		setIsScrolledAway( false );
		const prefersReducedMotion = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches;
		scrollNode.scrollTo( {
			top: scrollNode.scrollHeight,
			behavior: prefersReducedMotion ? 'auto' : 'smooth',
		} );
	}, [ scrollNode ] );

	return { spacerRef, isScrolledAway, scrollToLatest };
}
