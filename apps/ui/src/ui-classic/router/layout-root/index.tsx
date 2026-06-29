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

function getSettingsSearchFromEvent( tabName: UserSettingsEventTab | undefined ) {
	if ( ! tabName ) {
		return {};
	}
	const tab = normalizeSettingsTab( tabName );
	return tab === 'preferences' ? {} : { tab };
}

function RootLayout() {
	const connector = useConnector();
	const navigate = useNavigate();

	useEffect( () => {
		return connector.onUserSettings( ( tabName ) => {
			void navigate( {
				to: '/settings',
				search: getSettingsSearchFromEvent( tabName ),
			} );
		} );
	}, [ connector, navigate ] );

	return <Outlet />;
}

export const rootRoute = createRootRouteWithContext< RouterContext >()( {
	component: RootLayout,
} );
