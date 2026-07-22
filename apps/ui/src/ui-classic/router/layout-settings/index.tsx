import { createRoute, Outlet, useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FullscreenChrome } from '@/components/fullscreen-chrome';
import { SettingsCloseContext } from '@/hooks/use-settings-close';
import { dashboardLayoutRoute } from '../layout-dashboard';
import styles from './style.module.css';

/**
 * Fullscreen host for the settings route. Nested inside the dashboard layout
 * so the sidebar and warm site preview stay mounted underneath, but rendered
 * through a portal to `document.body` as an opaque overlay: settings simply
 * appears on top of the static dashboard — no layout reflow, no sidebar
 * animation — and closing navigates back to the route the user came from,
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

	return createPortal(
		<div className={ styles.root }>
			{ /* Drag edges only — the close button lives inside the settings
			     header (provided via context) rather than floating over it. */ }
			<FullscreenChrome />
			<SettingsCloseContext.Provider value={ close }>
				<Outlet />
			</SettingsCloseContext.Provider>
		</div>,
		document.body
	);
}

export const settingsLayoutRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	id: 'settings-layout',
	component: SettingsLayout,
} );
