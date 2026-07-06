import { createRootRouteWithContext, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useConnector } from '@/data/core';
import type { Connector } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';

export interface RouterContext {
	queryClient: QueryClient;
	connector: Connector;
}

// Bridges the Electron application menu ("Add Site…", "Settings…" and their
// ⌘N / ⌘, shortcuts) to router navigation. Mounted at the root so the
// shortcuts work from any route, including onboarding.
function AppMenuNavigation() {
	const connector = useConnector();
	const navigate = useNavigate();

	useEffect(
		() => connector.onAddSite( () => void navigate( { to: '/onboarding' } ) ),
		[ connector, navigate ]
	);
	useEffect(
		() => connector.onOpenSettings( () => void navigate( { to: '/settings' } ) ),
		[ connector, navigate ]
	);

	return null;
}

export const rootRoute = createRootRouteWithContext< RouterContext >()( {
	component: () => (
		<>
			<AppMenuNavigation />
			<Outlet />
		</>
	),
} );
