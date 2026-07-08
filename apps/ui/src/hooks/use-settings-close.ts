import { createContext, useContext } from 'react';

/**
 * The settings layout renders the settings/site-settings views as a fullscreen
 * overlay and owns the "close" action (navigate back to where the user was).
 * The views render the close button inside their own toolbar, so the handler is
 * shared down through this context rather than threaded as props through the
 * route components. `null` when a view is rendered outside the settings overlay
 * (e.g. the site-settings form embedded in the overview), where no close button
 * should appear.
 */
export const SettingsCloseContext = createContext< ( () => void ) | null >( null );

export function useSettingsClose(): ( () => void ) | null {
	return useContext( SettingsCloseContext );
}
