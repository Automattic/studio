import { useState, useEffect, useCallback } from 'react';
import { DEFAULT_WIDTH, SIDEBAR_WIDTH } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';

const SIDEBAR_BREAKPOINT = DEFAULT_WIDTH;

export function useSidebarVisibility() {
	const [ dynamicBreakPoint, setDynamicBreakPoint ] = useState( SIDEBAR_BREAKPOINT );
	const [ isSidebarVisible, setIsSidebarVisible ] = useState( true );
	const [ isLowerThanBreakpoint, setIsLowerThanBreakpoint ] = useState( false );

	useEffect( () => {
		const handleResize = () => {
			const el = document.querySelector( 'div[role="tablist"]' );
			if (
				! isLowerThanBreakpoint && // Only recalculate the breakpoint if bigger than the default
				el?.clientWidth &&
				el?.scrollWidth &&
				el?.clientWidth < el?.scrollWidth
			) {
				setDynamicBreakPoint( el?.clientWidth + SIDEBAR_WIDTH + 10 );
			}

			setIsLowerThanBreakpoint( window.innerWidth < dynamicBreakPoint );
		};
		window.addEventListener( 'resize', handleResize );
		return () => {
			window.removeEventListener( 'resize', handleResize );
		};
	}, [ dynamicBreakPoint, isLowerThanBreakpoint ] );

	useEffect( () => {
		if ( isLowerThanBreakpoint ) {
			setIsSidebarVisible( false );
		} else {
			setIsSidebarVisible( true );
		}
	}, [ isLowerThanBreakpoint ] );

	const toggleSidebar = useCallback( () => {
		getIpcApi().toggleMinWindowWidth( isSidebarVisible );
		setIsSidebarVisible( ! isSidebarVisible );
	}, [ isSidebarVisible ] );

	return { isSidebarVisible, toggleSidebar };
}
