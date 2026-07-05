import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import { queryClient } from '@/data/core';
import { createAppRouter } from '@/ui-classic/router/router';
import type { Connector } from '@/data/core';

interface ClassicUiAppProps {
	connector: Connector;
}

export function ClassicUiApp( { connector }: ClassicUiAppProps ) {
	const router = useMemo( () => createAppRouter( { queryClient, connector } ), [ connector ] );

	// Clicking a chat OS notification focuses the window (handled by the
	// host) and lands the user on the session that needs their attention.
	useEffect( () => {
		return connector.onChatNotificationClicked( ( { sessionId } ) => {
			void router.navigate( { to: '/sessions/$sessionId', params: { sessionId } } );
		} );
	}, [ connector, router ] );

	return (
		<div data-ui-mode="classic">
			<RouterProvider router={ router } />
		</div>
	);
}
