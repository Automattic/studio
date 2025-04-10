import { useState, useEffect, useCallback } from 'react';
import { DEFAULT_WIDTH } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';

const SIDEBAR_BREAKPOINT = DEFAULT_WIDTH;

export function useSidebarVisibility() {
	const [ isSidebarVisible, setIsSidebarVisible ] = useState( true );
	const [ isLowerThanBreakpoint, setIsLowerThanBreakpoint ] = useState( false );

	useEffect( () => {
		const handleResize = () => {
			setIsLowerThanBreakpoint( window.innerWidth < SIDEBAR_BREAKPOINT );
		};
		window.addEventListener( 'resize', handleResize );
		return () => {
			window.removeEventListener( 'resize', handleResize );
		};
	}, [] );

	useEffect( () => {
		if ( isLowerThanBreakpoint ) {
			setIsSidebarVisible( false );
		} else {
			setIsSidebarVisible( true );
		}
	}, [ isLowerThanBreakpoint ] );

	const toggleSidebar = useCallback( () => {
		void getIpcApi().toggleMinWindowWidth( isSidebarVisible );
		setIsSidebarVisible( ! isSidebarVisible );
	}, [ isSidebarVisible ] );

	return { isSidebarVisible, toggleSidebar };
}
