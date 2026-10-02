import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { createAppRouter } from '@/router/router';
import { AppProviders } from './app-providers';
import type { Connector } from '@/data/core';
import '@/index.css';

export function App( { connector }: { connector: Connector } ) {
	const [ router ] = useState( createAppRouter );
	return (
		<AppProviders connector={ connector }>
			<RouterProvider router={ router } />
		</AppProviders>
	);
}
