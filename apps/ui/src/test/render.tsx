import { QueryClient } from '@tanstack/react-query';
import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { App } from '@/app';
import { AppProviders } from '@/app/app-providers';
import { resetAiCreditsNoticeForTests } from '@/data/ai-credits-notice';
import { resetAppMessagesForTests } from '@/data/app-messages';
import { createFakeConnector, type FakeConnector } from './fake-connector';
import type { ReactNode } from 'react';

const queryClients = new Set< QueryClient >();

export function createTestQueryClient() {
	const queryClient = new QueryClient( {
		defaultOptions: {
			queries: { retry: false, gcTime: Infinity, networkMode: 'always' },
			mutations: { networkMode: 'always' },
		},
	} );
	queryClients.add( queryClient );
	return queryClient;
}

// Unmount first, then drop the queries a test left in flight, then let TanStack
// Query's batched notification (a 0 ms timer) run while jsdom still exists: one
// firing after the environment is torn down is an unhandled "window is not
// defined" that fails the whole run on a slow machine, though every test passed.
afterEach( async () => {
	cleanup();
	for ( const queryClient of queryClients ) {
		await queryClient.cancelQueries();
		queryClient.clear();
	}
	queryClients.clear();
	await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	resetAppMessagesForTests();
	resetAiCreditsNoticeForTests();
} );

interface RenderOptions {
	connector?: FakeConnector;
	queryClient?: QueryClient;
	path?: string;
}

/** Renders the whole app, router included, at `path`. */
export function renderApp( {
	connector = createFakeConnector(),
	queryClient = createTestQueryClient(),
	path = '/',
}: RenderOptions = {} ) {
	const history = createMemoryHistory( { initialEntries: [ path ] } );
	const user = userEvent.setup();
	const view = render(
		<App connector={ connector } queryClient={ queryClient } history={ history } />
	);
	return { ...view, connector, queryClient, history, user };
}

/**
 * Renders `ui` inside the app's providers and a router whose only route renders
 * it, so components that link or navigate work without the route tree.
 */
export function renderWithProviders(
	ui: ReactNode,
	{
		connector = createFakeConnector(),
		queryClient = createTestQueryClient(),
		path = '/',
	}: RenderOptions = {}
) {
	const history = createMemoryHistory( { initialEntries: [ path ] } );
	const router = createRouter( {
		routeTree: createRootRoute( { component: () => ui } ),
		history,
	} );
	const user = userEvent.setup();
	const view = render(
		<AppProviders connector={ connector } queryClient={ queryClient }>
			<RouterProvider router={ router } />
		</AppProviders>
	);
	return { ...view, connector, queryClient, history, user };
}
