import { createContext, useContext } from 'react';

/**
 * The settings layout renders the settings view as a fullscreen overlay and
 * owns the "close" action (navigate back to where the user was). The view
 * renders the close button inside its own toolbar, so the handler is shared
 * down through this context rather than threaded as props through the route
 * components. `null` when the view is rendered outside the settings overlay,
 * where no close button should appear.
 */
export const SettingsCloseContext = createContext< ( () => void ) | null >( null );

export function useSettingsClose(): ( () => void ) | null {
	return useContext( SettingsCloseContext );
}
