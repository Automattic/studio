/**
 * Addon main content routing and focus management.
 *
 * FocusedAddonContext — shared context that both sidebar items and mainContentRenderer
 * functions can read. Sidebar items call setFocusedAddonId to claim the main content area.
 * mainContentRenderer functions check focusedAddonId to decide whether to render.
 * Focus is cleared automatically when the user selects a Studio site.
 *
 * AddonFocusProvider must be placed above both the sidebar and the main content area
 * so that sidebar items can call setFocusedAddonId.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useEnabledAddons } from 'src/modules/addons/enabled-addons-context';
import type { ReactNode } from 'react';
import type { MainContentContext } from 'src/modules/addons/addon-api';

interface FocusedAddonContextValue {
	focusedAddonId: string | null;
	setFocusedAddonId: ( id: string | null ) => void;
}

export const FocusedAddonContext = createContext< FocusedAddonContextValue >( {
	focusedAddonId: null,
	setFocusedAddonId: () => {},
} );

export function useFocusedAddon(): FocusedAddonContextValue {
	return useContext( FocusedAddonContext );
}

/**
 * Provides FocusedAddonContext to the subtree. Place this above both the sidebar
 * and the main content so both can read/write the focused addon id.
 */
export function AddonFocusProvider( {
	children,
	selectedSiteId,
}: {
	children: ReactNode;
	selectedSiteId: string | null;
} ) {
	const [ focusedAddonId, setFocusedAddonIdState ] = useState< string | null >( null );
	const prevSiteIdRef = useRef( selectedSiteId );

	// Clear focus when the user selects a Studio site
	useEffect( () => {
		if ( selectedSiteId !== prevSiteIdRef.current ) {
			prevSiteIdRef.current = selectedSiteId;
			if ( selectedSiteId !== null ) {
				setFocusedAddonIdState( null );
			}
		}
	}, [ selectedSiteId ] );

	const setFocusedAddonId = useCallback( ( id: string | null ) => {
		setFocusedAddonIdState( id );
	}, [] );

	return (
		<FocusedAddonContext.Provider value={ { focusedAddonId, setFocusedAddonId } }>
			{ children }
		</FocusedAddonContext.Provider>
	);
}

export function useAddonMainContentRenderer( selectedSiteId: string | null ): ReactNode | null {
	const enabledAddons = useEnabledAddons();
	const { focusedAddonId, setFocusedAddonId } = useFocusedAddon();

	const context: MainContentContext = {
		selectedSiteId,
		focusedAddonId,
		setFocusedAddonId,
	};

	for ( const addon of enabledAddons ) {
		if ( addon.mainContentRenderer ) {
			const result = addon.mainContentRenderer( context );
			if ( result != null ) {
				return result;
			}
		}
	}

	return null;
}
