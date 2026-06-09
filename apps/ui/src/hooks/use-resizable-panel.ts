import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	clampResizablePanelWidth,
	getResizablePanelMaxWidth,
	getStoredResizablePanelWidth,
	getViewportWidth,
	storeResizablePanelWidth,
	type ResizablePanelConfig,
} from '@/lib/resizable-panels';
import type { KeyboardEvent, MouseEvent } from 'react';

interface UseResizablePanelOptions {
	config: ResizablePanelConfig;
	disabled?: boolean;
	edge: 'left' | 'right';
	storageKey: string;
}

export function useResizablePanel( {
	config,
	disabled = false,
	edge,
	storageKey,
}: UseResizablePanelOptions ) {
	const [ viewportWidth, setViewportWidth ] = useState( getViewportWidth );
	const [ width, setWidth ] = useState( () =>
		getStoredResizablePanelWidth( storageKey, config, getViewportWidth() )
	);
	const [ isResizing, setIsResizing ] = useState( false );
	const dragStartX = useRef( 0 );
	const dragStartWidth = useRef( 0 );

	const maxWidth = useMemo(
		() => getResizablePanelMaxWidth( viewportWidth, config ),
		[ config, viewportWidth ]
	);

	const saveWidth = useCallback(
		( nextWidth: number ) => {
			const clampedWidth = clampResizablePanelWidth( nextWidth, config, getViewportWidth() );
			setWidth( clampedWidth );
			storeResizablePanelWidth( storageKey, clampedWidth );
		},
		[ config, storageKey ]
	);

	const handleResizeStart = useCallback(
		( event: MouseEvent< HTMLElement > ) => {
			if ( disabled ) {
				return;
			}
			if ( event.button !== 0 ) {
				return;
			}
			event.preventDefault();
			setIsResizing( true );
			dragStartX.current = event.clientX;
			dragStartWidth.current = width;
		},
		[ disabled, width ]
	);

	const handleKeyDown = useCallback(
		( event: KeyboardEvent< HTMLElement > ) => {
			if ( disabled ) {
				return;
			}
			const step = event.shiftKey ? 40 : 16;
			if ( event.key === 'Home' ) {
				event.preventDefault();
				saveWidth( config.minWidth );
				return;
			}
			if ( event.key === 'End' ) {
				event.preventDefault();
				saveWidth( maxWidth );
				return;
			}
			if ( event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' ) {
				return;
			}
			event.preventDefault();
			const direction = event.key === 'ArrowRight' ? 1 : -1;
			const delta = edge === 'right' ? direction * step : direction * -step;
			saveWidth( width + delta );
		},
		[ config.minWidth, disabled, edge, maxWidth, saveWidth, width ]
	);

	useEffect( () => {
		if ( disabled ) {
			return;
		}
		const handleResize = () => {
			const nextViewportWidth = getViewportWidth();
			setViewportWidth( nextViewportWidth );
			setWidth( ( currentWidth ) =>
				clampResizablePanelWidth( currentWidth, config, nextViewportWidth )
			);
		};
		window.addEventListener( 'resize', handleResize );
		return () => window.removeEventListener( 'resize', handleResize );
	}, [ config, disabled ] );

	useEffect( () => {
		if ( disabled || ! isResizing ) {
			return;
		}

		let rafId: number | undefined;
		const originalCursor = document.body.style.cursor;
		const originalUserSelect = document.body.style.userSelect;
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';

		const handleMouseMove = ( event: globalThis.MouseEvent ) => {
			if ( rafId ) {
				cancelAnimationFrame( rafId );
			}
			rafId = requestAnimationFrame( () => {
				const delta =
					edge === 'right'
						? event.clientX - dragStartX.current
						: dragStartX.current - event.clientX;
				setWidth(
					clampResizablePanelWidth( dragStartWidth.current + delta, config, getViewportWidth() )
				);
			} );
		};

		const handleMouseUp = ( event: globalThis.MouseEvent ) => {
			setIsResizing( false );
			if ( rafId ) {
				cancelAnimationFrame( rafId );
			}
			const delta =
				edge === 'right' ? event.clientX - dragStartX.current : dragStartX.current - event.clientX;
			saveWidth( dragStartWidth.current + delta );
		};

		document.addEventListener( 'mousemove', handleMouseMove );
		document.addEventListener( 'mouseup', handleMouseUp );

		return () => {
			if ( rafId ) {
				cancelAnimationFrame( rafId );
			}
			document.body.style.cursor = originalCursor;
			document.body.style.userSelect = originalUserSelect;
			document.removeEventListener( 'mousemove', handleMouseMove );
			document.removeEventListener( 'mouseup', handleMouseUp );
		};
	}, [ config, disabled, edge, isResizing, saveWidth ] );

	return {
		width,
		minWidth: config.minWidth,
		maxWidth,
		isResizing,
		handleResizeStart,
		handleKeyDown,
	};
}
