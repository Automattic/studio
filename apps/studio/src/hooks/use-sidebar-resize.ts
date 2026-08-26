import { useState, useCallback, useRef, useEffect } from 'react';
import {
	SIDEBAR_MIN_WIDTH,
	SIDEBAR_MAX_WIDTH,
	LOCAL_STORAGE_SIDEBAR_WIDTH_KEY,
} from 'src/constants';
import { getSavedSidebarWidth } from 'src/lib/sidebar-utils';

function saveWidth( width: number ) {
	localStorage.setItem( LOCAL_STORAGE_SIDEBAR_WIDTH_KEY, String( width ) );
}

export function useSidebarResize( isSidebarVisible: boolean, toggleSidebar: () => void ) {
	const [ sidebarWidth, setSidebarWidth ] = useState( getSavedSidebarWidth );
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
				setSidebarWidth( Math.min( SIDEBAR_MAX_WIDTH, Math.max( SIDEBAR_MIN_WIDTH, newWidth ) ) );
			} );
		};

		const handleMouseUp = ( e: MouseEvent ) => {
			setIsDragging( false );
			cancelAnimationFrame( rafId );

			const delta = e.clientX - dragStartX.current;
			const finalWidth = dragStartWidth.current + delta;
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
