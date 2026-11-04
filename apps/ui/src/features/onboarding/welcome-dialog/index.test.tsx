import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeConnector, TEST_USER } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { Connector } from '@/data/core';

async function firstLaunch( { signedIn = false, overrides = {} as Partial< Connector > } = {} ) {
	const view = renderApp( {
		connector: createFakeConnector(
			{ user: signedIn ? TEST_USER : null },
			{
				getOnboardingCompleted: async () => false,
				...overrides,
			}
		),
	} );
	await screen.findByRole( 'dialog', { name: 'Welcome to WordPress Studio' } );
	await waitFor( () => expect( screen.getByRole( 'checkbox' ) ).toBeEnabled() );
	return view;
}

afterEach( () => vi.restoreAllMocks() );

describe( 'Welcome dialog', () => {
	it( 'does not show Continue as loading while saving usage preferences', async () => {
		const { connector } = await firstLaunch( {
			overrides: { setUserPreferences: () => new Promise( () => {} ) },
		} );
		const button = screen.getByRole( 'button', { name: 'Continue with WordPress.com' } );
		await waitFor( () => expect( button ).toBeEnabled() );
		fireEvent.click( screen.getByRole( 'checkbox' ) );
		await waitFor( () => expect( connector.setUserPreferences ).toHaveBeenCalled() );
		expect( button ).toBeDisabled();
		expect( button ).not.toHaveAttribute( 'aria-busy', 'true' );
	} );

	it.each( [ 'Close', 'Not now' ] )(
		'continues without authentication using %s',
		async ( dismissLabel ) => {
			const { connector, history } = await firstLaunch();
			expect(
				screen.getByRole( 'checkbox', { name: 'Share anonymous usage statistics' } )
			).toBeVisible();
			fireEvent.click( screen.getByRole( 'button', { name: dismissLabel } ) );
			await screen.findByRole( 'dialog', { name: 'Add site' } );
			expect( connector.authenticate ).not.toHaveBeenCalled();
			expect( connector.setOnboardingCompleted ).toHaveBeenCalledExactlyOnceWith(
				true,
				expect.any( Object )
			);
			expect( connector.setOnboardingHints ).not.toHaveBeenCalled();
			expect( history.location.search ).toContain( 'addSite=create' );
			fireEvent.click( screen.getByRole( 'button', { name: 'Close Add site' } ) );
			expect(
				await screen.findByText( 'Add a local WordPress site to get started.' )
			).toBeVisible();
		}
	);

	it( 'completes after confirmed authentication', async () => {
		const { connector } = await firstLaunch();
		fireEvent.click( screen.getByRole( 'button', { name: 'Continue with WordPress.com' } ) );
		await screen.findByRole( 'dialog', { name: 'Add site' } );
		expect( connector.authenticate ).toHaveBeenCalledExactlyOnceWith(
			true,
			'onboarding',
			expect.any( Object )
		);
		expect( connector.setOnboardingCompleted ).toHaveBeenCalledExactlyOnceWith(
			true,
			expect.any( Object )
		);
	} );
	it( 'completes onboarding on Escape', async () => {
		const { connector } = await firstLaunch();
		fireEvent.keyDown( screen.getByRole( 'dialog', { name: 'Welcome to WordPress Studio' } ), {
			key: 'Escape',
		} );
		await screen.findByRole( 'dialog', { name: 'Add site' } );
		expect( connector.setOnboardingCompleted ).toHaveBeenCalledExactlyOnceWith(
			true,
			expect.any( Object )
		);
	} );

	it( 'stays on the welcome screen when OAuth closes without an account', async () => {
		const { connector } = await firstLaunch( { overrides: { authenticate: async () => {} } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Continue with WordPress.com' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Continue with WordPress.com' } ) ).toBeEnabled()
		);
		expect( screen.getByRole( 'dialog', { name: 'Welcome to WordPress Studio' } ) ).toBeVisible();
		expect( connector.setOnboardingCompleted ).not.toHaveBeenCalled();
	} );

	it( 'shows an authentication error and allows retry', async () => {
		const { connector } = await firstLaunch();
		connector.authenticate.mockRejectedValueOnce( new Error( 'Login window closed' ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Continue with WordPress.com' } ) );
		expect( await screen.findByText( 'Login window closed' ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Continue with WordPress.com' } ) );
		await screen.findByRole( 'dialog', { name: 'Add site' } );
	} );

	it( 'continues without OAuth when already signed in', async () => {
		const { connector } = await firstLaunch( { signedIn: true } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Continue' } ) );
		await screen.findByRole( 'dialog', { name: 'Add site' } );
		expect( connector.authenticate ).not.toHaveBeenCalled();
	} );

	it( 'allows Not now while offline', async () => {
		vi.spyOn( navigator, 'onLine', 'get' ).mockReturnValue( false );
		await firstLaunch();
		expect( screen.getByRole( 'button', { name: 'Continue with WordPress.com' } ) ).toBeDisabled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Not now' } ) );
		await screen.findByRole( 'dialog', { name: 'Add site' } );
	} );

	it( 'can save setup again after a persistence failure', async () => {
		const { connector } = await firstLaunch();
		connector.setOnboardingCompleted.mockRejectedValueOnce( new Error( 'Disk unavailable' ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );
		expect(
			await screen.findByText( 'Setup could not be saved. Please try again.' )
		).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );
		await screen.findByRole( 'dialog', { name: 'Add site' } );
	} );

	it( 'does not interrupt Add site if authentication finishes after closing', async () => {
		let resolveLogin = () => {};
		const { connector } = await firstLaunch( {
			overrides: {
				authenticate: () =>
					new Promise< void >( ( resolve ) => {
						resolveLogin = resolve;
					} ),
			},
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Continue with WordPress.com' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );
		await screen.findByRole( 'dialog', { name: 'Add site' } );
		await act( async () => {
			connector.state.user = TEST_USER;
			resolveLogin();
		} );
		expect( screen.getByRole( 'dialog', { name: 'Add site' } ) ).toBeVisible();
		expect( connector.setOnboardingCompleted ).toHaveBeenCalledTimes( 1 );
	} );
} );
