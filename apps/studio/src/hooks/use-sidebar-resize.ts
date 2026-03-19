import { useState, useCallback, useRef, useEffect } from 'react';
import {
	SIDEBAR_WIDTH,
	SIDEBAR_MIN_WIDTH,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_SNAP_THRESHOLD,
	LOCAL_STORAGE_SIDEBAR_WIDTH_KEY,
} from 'src/constants';

function loadSavedWidth(): number {
	const saved = localStorage.getItem( LOCAL_STORAGE_SIDEBAR_WIDTH_KEY );
	if ( saved ) {
		const parsed = Number( saved );
		if ( ! isNaN( parsed ) && parsed >= SIDEBAR_MIN_WIDTH && parsed <= SIDEBAR_MAX_WIDTH ) {
			return parsed;
		}
	}
	return SIDEBAR_WIDTH;
}

function saveWidth( width: number ) {
	localStorage.setItem( LOCAL_STORAGE_SIDEBAR_WIDTH_KEY, String( width ) );
}

export function useSidebarResize( isSidebarVisible: boolean, toggleSidebar: () => void ) {
	const [ sidebarWidth, setSidebarWidth ] = useState( loadSavedWidth );
	const [ isDragging, setIsDragging ] = useState( false );
	const dragStartX = useRef( 0 );
	const dragStartWidth = useRef( 0 );

	const handleMouseDown = useCallback(
		( e: React.MouseEvent ) => {
			e.preventDefault();
			setIsDragging( true );
			dragStartX.current = e.clientX;
			dragStartWidth.current = isSidebarVisible ? sidebarWidth : 0;
		},
		[ sidebarWidth, isSidebarVisible ]
	);

	useEffect( () => {
		if ( ! isDragging ) {
			return;
		}

		let rafId: number;

		const handleMouseMove = ( e: MouseEvent ) => {
			cancelAnimationFrame( rafId );
			rafId = requestAnimationFrame( () => {
				const delta = e.clientX - dragStartX.current;
				const newWidth = dragStartWidth.current + delta;

				if ( newWidth < SIDEBAR_SNAP_THRESHOLD ) {
					// Will snap closed on mouseup
					setSidebarWidth( Math.max( 0, newWidth ) );
					return;
				}

				setSidebarWidth( Math.min( SIDEBAR_MAX_WIDTH, Math.max( SIDEBAR_MIN_WIDTH, newWidth ) ) );
			} );
		};

		const handleMouseUp = ( e: MouseEvent ) => {
			setIsDragging( false );
			cancelAnimationFrame( rafId );

			const delta = e.clientX - dragStartX.current;
			const finalWidth = dragStartWidth.current + delta;

			if ( finalWidth < SIDEBAR_SNAP_THRESHOLD ) {
				// Snap closed — restore the last good width for when it reopens
				setSidebarWidth(
					dragStartWidth.current > SIDEBAR_MIN_WIDTH ? dragStartWidth.current : SIDEBAR_WIDTH
				);
				if ( isSidebarVisible ) {
					toggleSidebar();
				}
				return;
			}

			const clampedWidth = Math.min( SIDEBAR_MAX_WIDTH, Math.max( SIDEBAR_MIN_WIDTH, finalWidth ) );
			setSidebarWidth( clampedWidth );
			saveWidth( clampedWidth );

			if ( ! isSidebarVisible ) {
				toggleSidebar();
			}
		};

		document.addEventListener( 'mousemove', handleMouseMove );
		document.addEventListener( 'mouseup', handleMouseUp );

		return () => {
			cancelAnimationFrame( rafId );
			document.removeEventListener( 'mousemove', handleMouseMove );
			document.removeEventListener( 'mouseup', handleMouseUp );
		};
	}, [ isDragging, isSidebarVisible, toggleSidebar ] );

	return {
		sidebarWidth,
		isDragging,
		handleMouseDown,
	};
}
