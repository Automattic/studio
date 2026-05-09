import { createRoute } from '@tanstack/react-router';
import { Desk } from '../desk';
import { desksRootRoute } from '../router/root';

export const userDeskRoute = createRoute( {
	getParentRoute: () => desksRootRoute,
	path: '/',
	component: Desk,
} );
