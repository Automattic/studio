import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getNoticeHistory } from '@/data/app-messages';
import { UserMenu } from '@/features/account';
import { AppToasts } from '@/features/notifications';
import { createFakeConnector, TEST_USER } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import type { AuthUser } from '@/data/core';

beforeEach( () => localStorage.clear() );

function setup( user: AuthUser | null = null ) {
	const connector = createFakeConnector( { user } );
	const view = renderWithProviders(
		<>
			<UserMenu />
			<AppToasts />
		</>,
		{ connector }
	);
	return {
		...view,
		changeUser: () => {
			connector.state.user = TEST_USER;
			connector.emit( 'onAuthStateChanged' );
		},
	};
}

const PROMPT = 'Do more with WordPress';

async function openLoginDialog() {
	fireEvent.click( await screen.findByRole( 'button', { name: 'Account' } ) );
	fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Log in or create account' } ) );
	const dialog = await screen.findByRole( 'dialog', { name: PROMPT } );
	return within( dialog ).findByRole( 'button', { name: 'Log in' } );
}

describe( 'AccountMenu', () => {
	it( 'offers settings and support in the signed-out account menu before opening login', async () => {
		const { connector, history } = setup();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Account' } ) );
		expect(
			await screen.findByRole( 'menuitem', { name: 'Log in or create account' } )
		).toBeVisible();
		expect( screen.getByRole( 'menuitem', { name: 'Providers' } ) ).toBeVisible();
		expect( screen.getByRole( 'menuitem', { name: 'Support' } ) ).toBeVisible();
		expect( screen.queryByRole( 'menuitem', { name: 'Log out' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'dialog', { name: PROMPT } ) ).not.toBeInTheDocument();
		expect( connector.authenticate ).not.toHaveBeenCalled();
		fireEvent.click( screen.getByRole( 'menuitem', { name: /Settings/ } ) );
		await waitFor( () => expect( history.location.search ).toContain( 'settings=general' ) );
	} );

	it.each( [ 'Help Center', 'Keyboard shortcuts', 'Send feedback' ] )(
		'opens %s from Support',
		async ( label ) => {
			const { user, connector, history } = setup( TEST_USER );
			await user.click( await screen.findByRole( 'button', { name: TEST_USER.displayName } ) );
			await user.click( await screen.findByRole( 'menuitem', { name: 'Support' } ) );
			expect( screen.queryByRole( 'menuitem', { name: 'About' } ) ).not.toBeInTheDocument();
			fireEvent.click( await screen.findByRole( 'menuitem', { name: label } ) );
			if ( label === 'Help Center' ) {
				expect( connector.openExternalUrl ).toHaveBeenCalledWith(
					'https://developer.wordpress.com/docs/developer-tools/studio/'
				);
			} else {
				await waitFor( () =>
					expect( history.location.search ).toContain(
						label === 'Keyboard shortcuts' ? 'settings=keyboard' : 'feedback=true'
					)
				);
			}
		}
	);

	it.each( [ 'retry', 'background' ] )(
		'clears account errors after %s recovery',
		async ( recovery ) => {
			const { connector, queryClient } = setup( TEST_USER );
			const account = await screen.findByRole( 'button', { name: TEST_USER.displayName } );
			connector.getAuthUser.mockRejectedValue( new Error( 'Failed to fetch' ) );
			await act( () => queryClient.invalidateQueries( { queryKey: [ 'auth-user' ] } ) );
			const notice = await screen.findByRole( 'dialog', { name: 'Couldn’t refresh your account' } );
			expect( screen.queryByRole( 'alert' ) ).not.toBeInTheDocument();
			expect( account ).toBeVisible();

			fireEvent.click( within( notice ).getByRole( 'button', { name: 'Retry' } ) );
			await screen.findByText( 'Action failed' );
			expect( within( notice ).getByRole( 'button', { name: 'Retry' } ) ).toBeEnabled();

			connector.getAuthUser.mockResolvedValue( TEST_USER );
			if ( recovery === 'retry' ) {
				fireEvent.click( within( notice ).getByRole( 'button', { name: 'Retry' } ) );
			} else {
				await act( () => queryClient.invalidateQueries( { queryKey: [ 'auth-user' ] } ) );
			}
			await waitFor( () => expect( notice ).not.toBeInTheDocument() );
			expect( account ).toBeVisible();
		}
	);

	it( 'explains connection before starting authentication and allows dismissal', async () => {
		const { connector } = setup();
		await openLoginDialog();
		expect(
			screen.getByText(
				'Create a free WordPress.com account to build with the agent, share previews, and publish.'
			)
		).toBeVisible();
		expect( connector.authenticate ).not.toHaveBeenCalled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: PROMPT } ) ).not.toBeInTheDocument()
		);
		expect( connector.authenticate ).not.toHaveBeenCalled();
	} );

	it( 'authenticates from Log in, closes the dialog, and restores Log in after logout', async () => {
		const { connector } = setup();
		fireEvent.click( await openLoginDialog() );
		await screen.findByRole( 'button', { name: TEST_USER.displayName } );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: PROMPT } ) ).not.toBeInTheDocument()
		);
		expect( await screen.findByText( 'Logged in to WordPress.com' ) ).toBeVisible();
		expect( connector.authenticate ).toHaveBeenCalledExactlyOnceWith(
			false,
			'settings',
			expect.any( Object )
		);
		fireEvent.click( screen.getByRole( 'button', { name: TEST_USER.displayName } ) );
		const menu = await screen.findByRole( 'menu' );
		expect( within( menu ).getByText( TEST_USER.displayName ) ).toBeVisible();
		expect( within( menu ).getByText( TEST_USER.email ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Log out' } ) );
		await screen.findByRole( 'button', { name: 'Account' } );
		expect( screen.queryByRole( 'dialog', { name: PROMPT } ) ).not.toBeInTheDocument();
		expect( await screen.findByText( 'Logged out of WordPress.com' ) ).toBeVisible();
		expect( connector.logout ).toHaveBeenCalledOnce();
	} );

	it( 'starts signup from Create account and closes after authentication', async () => {
		const { connector } = setup();
		await openLoginDialog();
		fireEvent.click( screen.getByRole( 'button', { name: 'Create account' } ) );
		await screen.findByRole( 'button', { name: TEST_USER.displayName } );
		expect( connector.authenticate ).toHaveBeenCalledExactlyOnceWith(
			true,
			'settings',
			expect.any( Object )
		);
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: PROMPT } ) ).not.toBeInTheDocument()
		);
	} );

	it( 'keeps both authentication paths available during signup and allows retry after failure', async () => {
		const { connector } = setup();
		let reject!: ( error: Error ) => void;
		connector.authenticate.mockImplementationOnce(
			() =>
				new Promise< void >( ( _resolve, rejectPromise ) => {
					reject = rejectPromise;
				} )
		);
		const login = await openLoginDialog();
		const signup = screen.getByRole( 'button', { name: 'Create account' } );
		fireEvent.click( signup );
		await waitFor( () => expect( connector.authenticate ).toHaveBeenCalledOnce() );
		expect( signup ).toBeEnabled();
		expect( signup ).not.toHaveAttribute( 'aria-busy', 'true' );
		expect( login ).toBeEnabled();
		expect( connector.authenticate ).toHaveBeenCalledExactlyOnceWith(
			true,
			'settings',
			expect.any( Object )
		);
		await act( async () => reject( new Error( 'Signup failed' ) ) );
		expect( await screen.findByRole( 'alert' ) ).toHaveTextContent( 'Signup failed' );
		expect( signup ).toBeEnabled();
		expect( login ).toBeEnabled();
		fireEvent.click( signup );
		await screen.findByRole( 'button', { name: TEST_USER.displayName } );
	} );

	it.each( [ 'Create account', 'Log in' ] )(
		'allows retrying %s while authentication is pending',
		async ( label ) => {
			const { connector } = setup();
			connector.authenticate.mockReturnValue( new Promise( () => {} ) );
			await openLoginDialog();
			const button = screen.getByRole( 'button', { name: label } );
			fireEvent.click( button );
			await waitFor( () => expect( connector.authenticate ).toHaveBeenCalledOnce() );
			expect( button ).toBeEnabled();
			expect( button ).not.toHaveAttribute( 'aria-busy', 'true' );
			fireEvent.click( button );
			await waitFor( () => expect( connector.authenticate ).toHaveBeenCalledTimes( 2 ) );
		}
	);

	it( 'opens the shared settings while logged out', async () => {
		const { history } = setup();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Account' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: /Settings/ } ) );
		await waitFor( () => expect( history.location.search ).toContain( 'settings=general' ) );
	} );

	it( 'closes the dialog when authentication changes outside the account menu', async () => {
		const { changeUser } = setup();
		await openLoginDialog();
		act( changeUser );
		await screen.findByRole( 'button', { name: TEST_USER.displayName } );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: PROMPT } ) ).not.toBeInTheDocument()
		);
		expect( await screen.findByText( 'Logged in to WordPress.com' ) ).toBeVisible();
	} );

	it( 'keeps the dialog open without confirming a canceled login', async () => {
		const { connector } = setup();
		connector.authenticate.mockResolvedValueOnce();
		const next = await openLoginDialog();
		fireEvent.click( next );
		await waitFor( () => expect( connector.authenticate ).toHaveBeenCalledOnce() );
		await waitFor( () => expect( next ).toBeEnabled() );
		expect( screen.getByRole( 'dialog', { name: PROMPT } ) ).toBeVisible();
		expect( screen.queryByText( 'Logged in to WordPress.com' ) ).not.toBeInTheDocument();
	} );

	it( 'shows login failures in the dialog and permits retry', async () => {
		const { connector } = setup();
		connector.authenticate.mockRejectedValueOnce( new Error( 'Login failed' ) );
		const next = await openLoginDialog();
		fireEvent.click( next );
		expect( await screen.findByRole( 'alert' ) ).toHaveTextContent( 'Login failed' );
		expect( screen.queryByText( 'Logged in to WordPress.com' ) ).not.toBeInTheDocument();
		await waitFor( () => expect( next ).toBeEnabled() );
		fireEvent.click( next );
		await screen.findByRole( 'button', { name: TEST_USER.displayName } );
		expect( connector.authenticate ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'clears an old login error when reopening the dialog', async () => {
		const { connector } = setup();
		connector.authenticate.mockRejectedValueOnce( new Error( 'Login failed' ) );
		fireEvent.click( await openLoginDialog() );
		await screen.findByText( 'Login failed' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await screen.findByRole( 'button', { name: 'Account' } );
		await openLoginDialog();
		expect( screen.queryByText( 'Login failed' ) ).not.toBeInTheDocument();
	} );

	it( 'opens Providers from the account menu', async () => {
		const { history } = setup( TEST_USER );
		fireEvent.click( await screen.findByRole( 'button', { name: TEST_USER.displayName } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Providers' } ) );
		await waitFor( () => expect( history.location.search ).toContain( 'settings=ai' ) );
	} );

	it( 'reports a failed logout in a toast', async () => {
		const { connector } = setup( TEST_USER );
		connector.logout.mockRejectedValueOnce( new Error( 'Network down' ) );
		fireEvent.click( await screen.findByRole( 'button', { name: TEST_USER.displayName } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Log out' } ) );
		expect( await screen.findByText( 'Could not log out' ) ).toBeVisible();
		expect( screen.getByText( 'Network down' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: TEST_USER.displayName } ) ).toBeVisible();
	} );

	it( 'keeps initial account lookup errors out of the footer', async () => {
		const connector = createFakeConnector();
		connector.getAuthUser.mockRejectedValue( new Error( 'Session expired' ) );
		renderWithProviders( <UserMenu />, { connector } );
		await waitFor( () =>
			expect( getNoticeHistory()[ 0 ]?.title ).toBe( 'Couldn’t refresh your account' )
		);
		expect( screen.queryByRole( 'alert' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Session expired' ) ).not.toBeInTheDocument();
	} );
} );
