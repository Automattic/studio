import { RouterProvider } from '@tanstack/react-router';
import { useMemo } from 'react';
import { queryClient } from '@/data/core';
import { createAppRouter } from '@/surfaces/shell/router';
import type { Connector } from '@/data/core';

interface StudioAppProps {
	connector: Connector;
}

export function StudioApp( { connector }: StudioAppProps ) {
	const router = useMemo( () => createAppRouter( { queryClient, connector } ), [ connector ] );

	return (
		<div data-ui-mode="studio">
			<RouterProvider router={ router } />
		</div>
	);
}
