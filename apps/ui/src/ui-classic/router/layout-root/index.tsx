import { createRootRouteWithContext, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { normalizeSettingsTab } from '@/components/settings-view';
import { useConnector } from '@/data/core';
import type { Connector, UserSettingsEventTab } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';

export interface RouterContext {
	queryClient: QueryClient;
	connector: Connector;
}

function getSettingsTabFromEvent( tabName: UserSettingsEventTab | undefined ) {
	return normalizeSettingsTab( tabName );
}

function RootLayout() {
	const connector = useConnector();
	const navigate = useNavigate();

	useEffect( () => {
		return connector.onUserSettings( ( tabName ) => {
			void navigate( {
				to: '/settings',
				search: { tab: getSettingsTabFromEvent( tabName ) },
			} );
		} );
	}, [ connector, navigate ] );

	return <Outlet />;
}

export const rootRoute = createRootRouteWithContext< RouterContext >()( {
	component: RootLayout,
} );
