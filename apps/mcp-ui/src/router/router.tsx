import { createMemoryHistory, createRouter } from '@tanstack/react-router';
import { rootRoute } from './layout-root';
import { libraryRoute } from './route-library';
import { localSiteRoute, wpcomSiteRoute } from './route-site-detail';

const routeTree = rootRoute.addChildren( [ libraryRoute, localSiteRoute, wpcomSiteRoute ] );

// The host owns the frame's URL, so routes live in memory.
export function createAppRouter() {
	return createRouter( {
		routeTree,
		history: createMemoryHistory( { initialEntries: [ '/' ] } ),
	} );
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType< typeof createAppRouter >;
	}
}
