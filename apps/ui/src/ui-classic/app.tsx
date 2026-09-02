import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import { queryClient } from '@/data/core';
import { useTextContextMenu } from '@/hooks/use-text-context-menu';
import { createAppRouter } from '@/ui-classic/router/router';
import type { Connector } from '@/data/core';

interface ClassicUiAppProps {
	connector: Connector;
}

export function ClassicUiApp( { connector }: ClassicUiAppProps ) {
	const router = useMemo( () => createAppRouter( { queryClient, connector } ), [ connector ] );

	useTextContextMenu();

	// Menus and dialogs portal into document.body, outside the wrapper below, so
	// the mode also goes on the root element for the icon-size rule to reach them.
	useEffect( () => {
		document.documentElement.setAttribute( 'data-ui-mode', 'classic' );
		return () => document.documentElement.removeAttribute( 'data-ui-mode' );
	}, [] );

	return (
		<div data-ui-mode="classic">
			<RouterProvider router={ router } />
		</div>
	);
}
