import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

const originalWidth = window.innerWidth;

beforeEach( () => {
	localStorage.clear();
	Object.defineProperty( window, 'innerWidth', { configurable: true, value: 1280 } );
} );
afterEach( () => {
	Object.defineProperty( window, 'innerWidth', { configurable: true, value: originalWidth } );
} );

function sidebarToggle( name: string ) {
	return screen
		.getAllByRole( 'button', { name } )
		.find( ( button ) => ! button.closest( '[inert]' ) )!;
}

async function emptyWorkspace() {
	const connector = createFakeConnector();
	const view = renderApp( { connector, path: '/sites' } );
	await screen.findByRole( 'dialog', { name: 'Add site' } );
	await view.user.keyboard( '{Escape}' );
	await waitFor( () =>
		expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument()
	);
	return view;
}

describe( 'the empty workspace sidebar', () => {
	it( 'starts closed and remembers a manually opened empty sidebar', async () => {
		const { user, connector, queryClient, unmount } = await emptyWorkspace();
		await user.click( sidebarToggle( 'Show sidebar' ) );
		expect( sidebarToggle( 'Hide sidebar' ) ).toBeVisible();
		await act( () => queryClient.invalidateQueries( { queryKey: [ 'sites' ] } ) );
		expect( sidebarToggle( 'Hide sidebar' ) ).toBeVisible();
		unmount();
		const next = renderApp( { connector, path: '/sites' } );
		await screen.findByRole( 'dialog', { name: 'Add site' } );
		await next.user.keyboard( '{Escape}' );
		expect( await waitFor( () => sidebarToggle( 'Hide sidebar' ) ) ).toBeVisible();
	} );

	it.each( [ 1280, 540 ] )(
		'reveals the first site without docking a narrow sidebar (width: %s)',
		async ( width ) => {
			Object.defineProperty( window, 'innerWidth', { configurable: true, value: width } );
			localStorage.setItem( 'studio-ui-sidebar-collapsed', 'true' );
			const { connector } = await emptyWorkspace();
			expect( sidebarToggle( 'Show sidebar' ) ).toBeVisible();
			await act( async () => {
				await connector.createSite( { name: 'First site', path: '/sites/first' } );
			} );
			await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } );
			expect(
				await waitFor( () => sidebarToggle( width === 1280 ? 'Hide sidebar' : 'Show sidebar' ) )
			).toBeVisible();
		}
	);
} );
