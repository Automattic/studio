import {
	useCallback,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	type ReactNode,
	type Ref,
} from 'react';
import { ActiveChatShortcuts } from '@/features/chats/chat-actions';
import { useScrollFade } from '@/lib/hooks';
import { ScrollBlur } from '@/lib/ui';
import styles from './style.module.css';
import type { AiSessionSummary } from '@/data/core';

interface SessionFrameProps {
	session?: AiSessionSummary;
	header?: ReactNode;
	background?: ReactNode;
	composer?: ReactNode;
	scrollRef?: Ref< HTMLDivElement >;
	rootRef?: ( node: HTMLDivElement | null ) => void;
	children?: ReactNode;
}

// Lays out the chat column as fixed chrome over a full-height conversation
// scroller. The site preview panel lives in the dashboard layout's
// PanelSplitFrame, which keeps it mounted across routes.
export function SessionFrame( {
	session,
	header,
	background,
	composer,
	scrollRef,
	rootRef: onRootNode,
	children,
}: SessionFrameProps ) {
	const scroller = useRef< HTMLDivElement >( null );
	const setFadeElement = useScrollFade< HTMLDivElement >( { inset: true } );
	const setScroller = useCallback(
		( node: HTMLDivElement | null ) => {
			scroller.current = node;
			setFadeElement( node );
		},
		[ setFadeElement ]
	);
	useImperativeHandle( scrollRef, () => scroller.current!, [] );
	const rootRef = useRef< HTMLDivElement | null >( null );
	const headerRef = useRef< HTMLDivElement >( null );
	const composerRef = useRef< HTMLDivElement >( null );

	useLayoutEffect( () => {
		const root = rootRef.current;
		if ( ! root ) {
			return;
		}

		const updateChromeSize = () => {
			root.style.setProperty( '--header-height', `${ headerRef.current?.offsetHeight ?? 0 }px` );
			root.style.setProperty(
				'--composer-height',
				`${ composerRef.current?.offsetHeight ?? 0 }px`
			);
		};

		updateChromeSize();

		const resizeObserver = new ResizeObserver( updateChromeSize );
		if ( headerRef.current ) {
			resizeObserver.observe( headerRef.current );
		}
		if ( composerRef.current ) {
			resizeObserver.observe( composerRef.current );
		}

		return () => resizeObserver.disconnect();
	}, [] );

	return (
		<>
			{ session ? <ActiveChatShortcuts session={ session } /> : null }
			<div
				ref={ ( node ) => {
					rootRef.current = node;
					onRootNode?.( node );
				} }
				className={ styles.root }
				data-chat-frame
				onContextMenuCapture={ ( event ) => {
					if (
						( event.target as Element ).closest(
							'input, textarea, [contenteditable="true"], [data-chat-transcript]'
						)
					) {
						event.stopPropagation();
					}
				} }
			>
				{ background }
				<div
					ref={ headerRef }
					className={ styles.headerLayer }
					data-sidebar-flyout-header={ !! header || undefined }
				>
					{ header }
				</div>
				<div ref={ setScroller } className={ styles.scroll }>
					{ children }
				</div>
				<ScrollBlur edge="top" className={ styles.topBlur } />
				{ composer ? (
					<div ref={ composerRef } className={ styles.composerOuter }>
						{ composer }
					</div>
				) : null }
			</div>
		</>
	);
}
