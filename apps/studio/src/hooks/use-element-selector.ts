import { useCallback, useEffect, useRef, useState } from 'react';
import type { ElementAttachment } from 'src/modules/ai/types';

interface UseElementSelectorOptions {
	getActiveIframe: () => HTMLIFrameElement | null;
}

export interface UseElementSelectorReturn {
	isSelecting: boolean;
	selectedElements: ElementAttachment[];
	activateSelection: () => void;
	deactivateSelection: () => void;
	removeElement: ( index: number ) => void;
	clearElements: () => void;
}

export function useElementSelector( {
	getActiveIframe,
}: UseElementSelectorOptions ): UseElementSelectorReturn {
	const [ isSelecting, setIsSelecting ] = useState( false );
	const [ selectedElements, setSelectedElements ] = useState< ElementAttachment[] >( [] );
	const isSelectingRef = useRef( false );

	const postToIframe = useCallback(
		( type: string ) => {
			const iframe = getActiveIframe();
			if ( iframe?.contentWindow ) {
				try {
					iframe.contentWindow.postMessage( { type }, '*' );
				} catch {
					// Cross-origin — postMessage should still work, but guard just in case
				}
			}
		},
		[ getActiveIframe ]
	);

	const activateSelection = useCallback( () => {
		setIsSelecting( true );
		isSelectingRef.current = true;
		postToIframe( 'studio:select-element:activate' );
	}, [ postToIframe ] );

	const deactivateSelection = useCallback( () => {
		setIsSelecting( false );
		isSelectingRef.current = false;
		postToIframe( 'studio:select-element:deactivate' );
	}, [ postToIframe ] );

	const removeElement = useCallback(
		( index: number ) => {
			setSelectedElements( ( prev ) => {
				const next = prev.filter( ( _, i ) => i !== index );
				if ( next.length === 0 ) {
					postToIframe( 'studio:select-element:clear' );
				}
				return next;
			} );
		},
		[ postToIframe ]
	);

	const clearElements = useCallback( () => {
		setSelectedElements( [] );
		postToIframe( 'studio:select-element:clear' );
	}, [ postToIframe ] );

	// Listen for postMessage events from the iframe
	useEffect( () => {
		const handleMessage = ( event: MessageEvent ) => {
			// Only accept messages from localhost origins
			if ( event.origin && ! /^https?:\/\/localhost(:\d+)?$/.test( event.origin ) ) {
				return;
			}

			if ( ! event.data?.type ) {
				return;
			}

			if ( event.data.type === 'studio:select-element:selected' && event.data.element ) {
				const el = event.data.element;
				const attachment: ElementAttachment = {
					cssSelector: el.cssSelector ?? '',
					tagName: el.tagName ?? '',
					outerHTML: el.outerHTML ?? '',
					textContent: el.textContent ?? '',
					computedStyles: el.computedStyles ?? {},
					boundingBox: el.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 },
					domPath: el.domPath ?? [],
					...( el.wpBlockName && { wpBlockName: el.wpBlockName } ),
				};
				setSelectedElements( [ attachment ] );
				setIsSelecting( false );
				isSelectingRef.current = false;
			}

			if ( event.data.type === 'studio:select-element:deactivated' ) {
				setIsSelecting( false );
				isSelectingRef.current = false;
			}
		};

		window.addEventListener( 'message', handleMessage );
		return () => window.removeEventListener( 'message', handleMessage );
	}, [] );

	// Escape key in the parent frame exits selection mode
	useEffect( () => {
		const handleKeyDown = ( e: KeyboardEvent ) => {
			if ( e.key === 'Escape' && isSelectingRef.current ) {
				e.preventDefault();
				deactivateSelection();
			}
		};
		window.addEventListener( 'keydown', handleKeyDown );
		return () => window.removeEventListener( 'keydown', handleKeyDown );
	}, [ deactivateSelection ] );

	return {
		isSelecting,
		selectedElements,
		activateSelection,
		deactivateSelection,
		removeElement,
		clearElements,
	};
}
