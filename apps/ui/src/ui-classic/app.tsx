import { RouterProvider } from '@tanstack/react-router';
import { useMemo } from 'react';
import { queryClient } from '@/data/core';
import { createAppRouter } from '@/ui-classic/router/router';
import type { Connector } from '@/data/core';

interface ClassicUiAppProps {
	connector: Connector;
}

export function ClassicUiApp( { connector }: ClassicUiAppProps ) {
	const router = useMemo( () => createAppRouter( { queryClient, connector } ), [ connector ] );

	return (
		<div data-ui-mode="classic">
			<RouterProvider router={ router } />
		</div>
	);
}
