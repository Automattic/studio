import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSettingsClose } from '@/hooks/use-settings-close';
import { settingsRoute } from '../route-settings';
import { createAppRouter } from '../router';
import { SettingsLayout } from './index';
import type { RouterContext } from '../layout-root';

// jsdom has no window.scrollTo; the router's scroll restoration calls it on
// every navigation.
vi.stubGlobal( 'scrollTo', vi.fn() );

function SettingsScreen() {
	const close = useSettingsClose();
	return (
		<div>
			<h1>Settings screen</h1>
			<button type="button" onClick={ () => close?.() }>
				Close settings
			</button>
		</div>
	);
}

function renderSettings( initialEntries: string[] ) {
	const rootRoute = createRootRoute();
	const layoutRoute = createRoute( {
		getParentRoute: () => rootRoute,
		id: 'settings-layout',
		component: SettingsLayout,
	} );
	const testSettingsRoute = createRoute( {
		getParentRoute: () => layoutRoute,
		path: '/settings',
		component: SettingsScreen,
	} );
	const indexRoute = createRoute( {
		getParentRoute: () => rootRoute,
		path: '/',
		component: () => <div>Home</div>,
	} );
	const otherRoute = createRoute( {
		getParentRoute: () => rootRoute,
		path: '/other',
		component: () => <div>Other</div>,
	} );
	const router = createRouter( {
		routeTree: rootRoute.addChildren( [
			indexRoute,
			otherRoute,
			layoutRoute.addChildren( [ testSettingsRoute ] ),
		] ),
		history: createMemoryHistory( { initialEntries } ),
	} );
	render( <RouterProvider router={ router } /> );
	return router;
}

describe( 'SettingsLayout', () => {
	it( 'renders the settings route in place', async () => {
		renderSettings( [ '/settings' ] );
		expect( await screen.findByText( 'Settings screen' ) ).toBeInTheDocument();
	} );

	it( 'close returns to the previous route', async () => {
		renderSettings( [ '/other', '/settings' ] );
		await screen.findByText( 'Settings screen' );

		fireEvent.click( screen.getByRole( 'button', { name: 'Close settings' } ) );

		expect( await screen.findByText( 'Other' ) ).toBeInTheDocument();
	} );

	it( 'close falls back to the index route when there is no history', async () => {
		renderSettings( [ '/settings' ] );
		await screen.findByText( 'Settings screen' );

		fireEvent.click( screen.getByRole( 'button', { name: 'Close settings' } ) );

		expect( await screen.findByText( 'Home' ) ).toBeInTheDocument();
	} );

	it( 'closes on Escape', async () => {
		renderSettings( [ '/other', '/settings' ] );
		await screen.findByText( 'Settings screen' );

		fireEvent.keyDown( document.body, { key: 'Escape' } );

		expect( await screen.findByText( 'Other' ) ).toBeInTheDocument();
	} );

	it( 'ignores Escape when a popup already consumed it', async () => {
		renderSettings( [ '/other', '/settings' ] );
		await screen.findByText( 'Settings screen' );

		// Mimics an open menu/select/dialog claiming the keypress.
		const consume = ( event: KeyboardEvent ) => event.preventDefault();
		document.addEventListener( 'keydown', consume, { capture: true } );
		try {
			fireEvent.keyDown( document.body, { key: 'Escape' } );
		} finally {
			document.removeEventListener( 'keydown', consume, { capture: true } );
		}

		expect( screen.getByText( 'Settings screen' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Other' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps /settings deep-linkable in the app route tree', () => {
		const router = createAppRouter( {} as RouterContext );
		const matches = router.matchRoutes( '/settings', {} );
		expect( matches.some( ( match ) => match.routeId === settingsRoute.id ) ).toBe( true );
	} );
} );
