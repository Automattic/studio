import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector, TEST_USER } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { Connector } from '@/data/core';

async function firstLaunch( { signedIn = false, overrides = {} as Partial< Connector > } = {} ) {
	const view = renderApp( {
		connector: createFakeConnector( signedIn ? {} : { user: null }, {
			getOnboardingCompleted: async () => false,
			...overrides,
		} ),
	} );
	await screen.findByRole( 'alertdialog', { name: 'Welcome to WordPress Studio' } );
	return view;
}

describe( 'Welcome dialog', () => {
	it( 'says what a WordPress.com account adds, and continues without one to Add site', async () => {
		const { connector, history } = await firstLaunch();
		expect( screen.getByText( 'With a free WordPress.com account' ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Continue without an account' } ) );
		await waitFor( () =>
			expect(
				screen.queryByRole( 'alertdialog', { name: 'Welcome to WordPress Studio' } )
			).not.toBeInTheDocument()
		);
		expect( connector.setOnboardingCompleted ).toHaveBeenCalledWith( true );
		expect( history.location.search ).toContain( 'addSite=create' );
	} );

	it( 'waits on the browser login, which can be cancelled', async () => {
		const { connector } = await firstLaunch( {
			overrides: { authenticate: () => new Promise( () => {} ) },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Log in with WordPress.com' } ) );
		expect(
			await screen.findByRole( 'button', { name: /Finish logging in in your browser/ } )
		).toBeVisible();
		expect( connector.authenticate ).toHaveBeenCalledWith( false, 'onboarding' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		expect(
			await screen.findByRole( 'button', { name: 'Log in with WordPress.com' } )
		).toBeVisible();
	} );

	it( 'shows who is signed in, with Continue', async () => {
		await firstLaunch( { signedIn: true } );
		expect( await screen.findByText( TEST_USER.displayName ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Continue' } ) ).toBeVisible();
		expect( screen.queryByText( 'With a free WordPress.com account' ) ).not.toBeInTheDocument();
	} );
} );
