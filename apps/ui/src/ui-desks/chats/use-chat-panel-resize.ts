import { useCallback, useEffect, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export const CHAT_PANEL_EXPANDED_WIDTH = 760;
export const CHAT_PANEL_COLLAPSED_WIDTH = 560;
export const CHAT_PANEL_COLLAPSE_THRESHOLD = CHAT_PANEL_EXPANDED_WIDTH;
export const CHAT_PANEL_MIN_WIDTH = 320;
export const CHAT_PANEL_MAX_WIDTH = 1200;

const CHAT_PANEL_STORAGE_KEY = 'ui-desks-chat-panel-width';
const CHAT_PANEL_VIEWPORT_MARGIN = 36;

function getViewportWidth() {
	return typeof window === 'undefined' ? CHAT_PANEL_MAX_WIDTH : window.innerWidth;
}

export function clampChatPanelWidth( width: number, viewportWidth = getViewportWidth() ) {
	return Math.max(
		CHAT_PANEL_MIN_WIDTH,
		Math.min( width, CHAT_PANEL_MAX_WIDTH, viewportWidth - CHAT_PANEL_VIEWPORT_MARGIN )
	);
}

function readStoredChatPanelWidth() {
	if ( typeof window === 'undefined' ) {
		return CHAT_PANEL_EXPANDED_WIDTH;
	}

	const stored = window.localStorage.getItem( CHAT_PANEL_STORAGE_KEY );
	const parsed = stored ? Number.parseInt( stored, 10 ) : Number.NaN;
	return Number.isFinite( parsed ) ? parsed : CHAT_PANEL_EXPANDED_WIDTH;
}

function persistChatPanelWidth( width: number ) {
	if ( typeof window === 'undefined' ) {
		return;
	}

	window.localStorage.setItem( CHAT_PANEL_STORAGE_KEY, String( width ) );
}

export function useChatPanelResize( side: 'left' | 'right' ) {
	const [ width, setWidth ] = useState( () =>
		clampChatPanelWidth( readStoredChatPanelWidth(), getViewportWidth() )
	);
	const [ isResizing, setIsResizing ] = useState( false );

	const updateWidth = useCallback( ( nextWidth: number ) => {
		const clamped = clampChatPanelWidth( nextWidth, getViewportWidth() );
		setWidth( clamped );
		persistChatPanelWidth( clamped );
	}, [] );

	const collapseList = useCallback( () => {
		updateWidth( CHAT_PANEL_COLLAPSED_WIDTH );
	}, [ updateWidth ] );

	const expandList = useCallback( () => {
		updateWidth( CHAT_PANEL_EXPANDED_WIDTH );
	}, [ updateWidth ] );

	useEffect( () => {
		const onResize = () => {
			setWidth( ( current ) => {
				const clamped = clampChatPanelWidth( current, getViewportWidth() );
				persistChatPanelWidth( clamped );
				return clamped;
			} );
		};

		window.addEventListener( 'resize', onResize );
		return () => window.removeEventListener( 'resize', onResize );
	}, [] );

	const startResize = useCallback(
		( event: ReactPointerEvent< HTMLDivElement > ) => {
			event.preventDefault();

			const dragOriginX = event.clientX;
			const startWidth = width;
			const direction = side === 'left' ? 1 : -1;

			setIsResizing( true );

			const onPointerMove = ( pointerEvent: PointerEvent ) => {
				const delta = ( pointerEvent.clientX - dragOriginX ) * direction;
				updateWidth( startWidth + delta );
			};

			const onPointerUp = () => {
				setIsResizing( false );
				window.removeEventListener( 'pointermove', onPointerMove );
				window.removeEventListener( 'pointerup', onPointerUp );
			};

			window.addEventListener( 'pointermove', onPointerMove );
			window.addEventListener( 'pointerup', onPointerUp );
		},
		[ side, updateWidth, width ]
	);

	return {
		width,
		isResizing,
		listCollapsed: width < CHAT_PANEL_COLLAPSE_THRESHOLD,
		collapseList,
		expandList,
		startResize,
	};
}
