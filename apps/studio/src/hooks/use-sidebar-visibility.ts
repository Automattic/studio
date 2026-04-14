import { useState, useEffect, useCallback } from 'react';
import { DEFAULT_WIDTH, MIN_WIDTH_SELECTOR_TO_MEASURE, APP_CHROME_SPACING } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getSavedSidebarWidth } from 'src/lib/sidebar-utils';

const SIDEBAR_BREAKPOINT = DEFAULT_WIDTH;

/**
 * This hook is used to determine if the sidebar should be visible based on either:
 * - A default breakpoint
 * - A calculated breakpoint based on the width of the element to measure plus the sidebar
 *
 * The element to measure will be selected based on the passed selector or a default one
 * if no selector is passed
 *
 * @param elementSelector - The selector of the element to measure.
 * @returns An object with the isSidebarVisible and toggleSidebar functions.
 */
export function useSidebarVisibility( elementSelector: string = MIN_WIDTH_SELECTOR_TO_MEASURE ) {
	const [ dynamicBreakPoint, setDynamicBreakPoint ] = useState( SIDEBAR_BREAKPOINT );
	const [ isSidebarVisible, setIsSidebarVisible ] = useState( true );
	const [ isLowerThanBreakpoint, setIsLowerThanBreakpoint ] = useState( false );

	useEffect( () => {
		const handleResize = () => {
			const el = document.querySelector( elementSelector );
			if (
				! isLowerThanBreakpoint && // Only recalculate if the sidebar is visible
				el?.clientWidth &&
				el?.scrollWidth &&
				el?.clientWidth < el?.scrollWidth
			) {
				// The new breakpoint is the width of the element to measure plus the sidebar plus the right padding
				setDynamicBreakPoint( el.clientWidth + getSavedSidebarWidth() + APP_CHROME_SPACING );
			}

			setIsLowerThanBreakpoint( window.innerWidth < dynamicBreakPoint );
		};
		window.addEventListener( 'resize', handleResize );
		return () => {
			window.removeEventListener( 'resize', handleResize );
		};
	}, [ dynamicBreakPoint, isLowerThanBreakpoint, elementSelector ] );

	useEffect( () => {
		if ( isLowerThanBreakpoint ) {
			setIsSidebarVisible( false );
		} else {
			setIsSidebarVisible( true );
		}
	}, [ isLowerThanBreakpoint ] );

	const toggleSidebar = useCallback( () => {
		void getIpcApi().toggleMinWindowWidth( isSidebarVisible, getSavedSidebarWidth() );
		setIsSidebarVisible( ! isSidebarVisible );
	}, [ isSidebarVisible ] );

	return { isSidebarVisible, toggleSidebar };
}
