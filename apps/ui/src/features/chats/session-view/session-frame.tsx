import { useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import { ChatContextMenu } from '@/features/chats/chat-actions';
import { ProgressiveBlur } from '@/features/chats/progressive-blur';
import styles from './style.module.css';
import type { AiSessionSummary } from '@/data/core';

interface SessionFrameProps {
	session?: AiSessionSummary;
	canExpand?: boolean;
	header?: ReactNode;
	composer?: ReactNode;
	scrollRef?: Ref< HTMLDivElement >;
	rootRef?: ( node: HTMLDivElement | null ) => void;
	children?: ReactNode;
}

// Lays out the chat column as fixed chrome over a full-height conversation
// scroller. The site preview panel lives in the dashboard layout's
// PreviewSplitFrame, which keeps it mounted across routes.
export function SessionFrame( {
	session,
	canExpand,
	header,
	composer,
	scrollRef,
	rootRef: onRootNode,
	children,
}: SessionFrameProps ) {
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

		if ( typeof ResizeObserver === 'undefined' ) {
			window.addEventListener( 'resize', updateChromeSize );
			return () => window.removeEventListener( 'resize', updateChromeSize );
		}

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
		<ChatContextMenu session={ session } canExpand={ canExpand }>
			<div
				ref={ ( node ) => {
					rootRef.current = node;
					onRootNode?.( node );
				} }
				className={ styles.root }
			>
				<div ref={ headerRef } className={ styles.headerLayer }>
					{ header }
				</div>
				<div ref={ scrollRef } className={ styles.scroll }>
					{ children }
				</div>
				{ composer ? (
					<>
						<ProgressiveBlur direction="up" className={ styles.composerBlur } fadeToSurface />
						<div ref={ composerRef } className={ styles.composerOuter }>
							{ composer }
						</div>
					</>
				) : null }
			</div>
		</ChatContextMenu>
	);
}
