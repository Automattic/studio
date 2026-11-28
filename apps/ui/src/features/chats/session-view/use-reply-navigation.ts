import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import type { ReplyReference } from '@studio/agent/protocol/reply-reference';

export function useReplyNavigation( {
	messageId,
	sessionId,
	scrollNode,
	loaded,
}: {
	messageId?: string;
	sessionId?: string;
	scrollNode: HTMLElement | null;
	loaded: boolean;
} ) {
	const navigate = useNavigate();
	const [ jump, setJump ] = useState( 0 );
	const [ reveal, setReveal ] = useState< { entryId: string; request: number } >();
	useEffect( () => {
		if ( ! messageId || ! scrollNode || ! loaded ) return;
		let cancelled = false;
		let nextFrame: number | undefined;
		let highlighted: HTMLElement | undefined;
		let timeout: ReturnType< typeof setTimeout > | undefined;
		const frame = requestAnimationFrame( () => {
			nextFrame = requestAnimationFrame( async () => {
				if ( cancelled ) return;
				const target = Array.from(
					scrollNode.querySelectorAll< HTMLElement >( '[data-message-id]' )
				).find( ( node ) => node.dataset.messageId === messageId );
				if ( ! target ) {
					if ( reveal?.entryId !== messageId || reveal.request !== jump )
						setReveal( { entryId: messageId, request: jump } );
					return;
				}
				const animations: Animation[] = [];
				for (
					let parent = target.parentElement;
					parent && parent !== scrollNode;
					parent = parent.parentElement
				) {
					animations.push(
						...( parent.getAnimations?.() ?? [] ).filter(
							( animation ) =>
								typeof CSSTransition !== 'undefined' &&
								animation instanceof CSSTransition &&
								animation.transitionProperty === 'height'
						)
					);
				}
				await Promise.allSettled( animations.map( ( animation ) => animation.finished ) );
				if ( cancelled ) return;
				target.scrollIntoView( { block: 'center', behavior: 'instant' } );
				target.dataset.highlighted = 'true';
				target.tabIndex = -1;
				target.focus( { preventScroll: true } );
				highlighted = target;
				timeout = setTimeout( () => target.removeAttribute( 'data-highlighted' ), 3000 );
			} );
		} );
		return () => {
			cancelled = true;
			cancelAnimationFrame( frame );
			if ( nextFrame ) cancelAnimationFrame( nextFrame );
			if ( timeout ) clearTimeout( timeout );
			highlighted?.removeAttribute( 'data-highlighted' );
		};
	}, [ messageId, sessionId, scrollNode, loaded, jump, reveal ] );
	const openReply = useCallback(
		( reply: ReplyReference ) => {
			if ( reply.sessionId === sessionId && reply.entryId === messageId ) {
				setJump( ( n ) => n + 1 );
				return;
			}
			void navigate( {
				to: '/sessions/$sessionId',
				params: { sessionId: reply.sessionId },
				search: { message: reply.entryId },
			} );
		},
		[ messageId, navigate, sessionId ]
	);
	return { openReply, revealMessage: reveal?.entryId === messageId ? reveal : undefined };
}
