import { createRoute, Outlet, useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect } from 'react';
import { SettingsCloseContext } from '@/hooks/use-settings-close';
import { dashboardLayoutRoute } from '../layout-dashboard';
import styles from './style.module.css';

/**
 * Host for the settings routes. Settings renders like any other dashboard
 * view — inside the sidebar layout's inset content frame, with the sidebar
 * and the window chrome (and the user's Frame color) still visible around
 * it. This layout adds only the shared close behavior: Escape and the close
 * button in each view's toolbar go back to the route the user came from,
 * which is instant because the dashboard never unmounted.
 */
export function SettingsLayout() {
	const navigate = useNavigate();
	const router = useRouter();
	const close = useCallback( () => {
		// `back()` returns to the exact session/site the user opened settings
		// from without remounting the dashboard. Deep-linking straight to
		// settings is the only case with nothing to go back to.
		if ( router.history.canGoBack() ) {
			router.history.back();
		} else {
			void navigate( { to: '/' } );
		}
	}, [ router, navigate ] );

	// Escape closes settings, matching the onboarding flow. Menus, selects, and
	// dialogs handle their own Escape and call preventDefault first, so honoring
	// defaultPrevented keeps Escape from closing settings out from under an open
	// popover.
	useEffect( () => {
		const handleKeyDown = ( event: KeyboardEvent ) => {
			if ( event.key === 'Escape' && ! event.defaultPrevented ) {
				close();
			}
		};
		document.addEventListener( 'keydown', handleKeyDown );
		return () => document.removeEventListener( 'keydown', handleKeyDown );
	}, [ close ] );

	return (
		<div className={ styles.root }>
			<SettingsCloseContext.Provider value={ close }>
				<Outlet />
			</SettingsCloseContext.Provider>
		</div>
	);
}

export const settingsLayoutRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	id: 'settings-layout',
	component: SettingsLayout,
} );
