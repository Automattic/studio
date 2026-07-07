import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePointerDrag } from '@/hooks/use-pointer-drag';
import {
	clampResizablePanelWidth,
	getResizablePanelMaxWidth,
	getStoredResizablePanelWidth,
	getViewportWidth,
	storeResizablePanelWidth,
	type ResizablePanelConfig,
} from '@/lib/resizable-panels';
import type { KeyboardEvent } from 'react';

interface UseResizablePanelOptions {
	config: ResizablePanelConfig;
	edge: 'left' | 'right';
	storageKey: string;
}

export function useResizablePanel( { config, edge, storageKey }: UseResizablePanelOptions ) {
	const [ viewportWidth, setViewportWidth ] = useState( getViewportWidth );
	const [ width, setWidth ] = useState( () =>
		getStoredResizablePanelWidth( storageKey, config, getViewportWidth() )
	);

	const maxWidth = useMemo(
		() => getResizablePanelMaxWidth( viewportWidth, config ),
		[ config, viewportWidth ]
	);

	const saveWidth = useCallback(
		( nextWidth: number ) => {
			const clampedWidth = clampResizablePanelWidth( nextWidth, config, getViewportWidth() );
			setWidth( clampedWidth );
			storeResizablePanelWidth( storageKey, clampedWidth );
			return clampedWidth;
		},
		[ config, storageKey ]
	);

	const { isDragging, onMouseDown } = usePointerDrag( {
		onStart: () => width,
		onMove: ( start, deltaX ) => {
			// `edge` decides which way a rightward drag grows the panel.
			const delta = edge === 'right' ? deltaX : -deltaX;
			const nextWidth = clampResizablePanelWidth( start + delta, config, getViewportWidth() );
			setWidth( nextWidth );
			return nextWidth;
		},
		onCommit: ( latest ) => {
			saveWidth( latest );
		},
	} );

	const handleKeyDown = useCallback(
		( event: KeyboardEvent< HTMLElement > ) => {
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
		[ config.minWidth, edge, maxWidth, saveWidth, width ]
	);

	useEffect( () => {
		const handleResize = () => {
			const nextViewportWidth = getViewportWidth();
			setViewportWidth( nextViewportWidth );
			setWidth( ( currentWidth ) =>
				clampResizablePanelWidth( currentWidth, config, nextViewportWidth )
			);
		};
		window.addEventListener( 'resize', handleResize );
		return () => window.removeEventListener( 'resize', handleResize );
	}, [ config ] );

	return {
		width,
		minWidth: config.minWidth,
		maxWidth,
		isResizing: isDragging,
		handleResizeStart: onMouseDown,
		handleKeyDown,
	};
}
