import { createRoute, redirect } from '@tanstack/react-router';
import { settingsLayoutRoute } from '../layout-settings';

export const settingsRoute = createRoute( {
	getParentRoute: () => settingsLayoutRoute,
	path: '/settings',
	beforeLoad: () => {
		throw redirect( { to: '/settings/preferences' } );
	},
} );
