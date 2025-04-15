// To run tests, execute `npm run test -- src/components/user-settings.test.tsx` from the root directory
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import UserSettings from 'src/components/user-settings';
import { useAuth } from 'src/hooks/use-auth';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useOffline } from 'src/hooks/use-offline';
import { store } from 'src/stores';

jest.mock( 'src/hooks/use-feature-flags' );
jest.mock( 'src/hooks/use-auth' );
jest.mock( 'src/hooks/use-ipc-listener' );

afterEach( () => {
	jest.clearAllMocks();
} );

function renderWithProvider( component: React.ReactElement ) {
	return render( <Provider store={ store }>{ component }</Provider> );
}

describe( 'UserSettings', () => {
	beforeEach( () => {
		// Triggers IPC listener to show modal
		( useIpcListener as jest.Mock ).mockImplementationOnce( ( listener, callback ) => {
			if ( listener === 'user-settings' ) {
				callback();
			}
		} );
	} );

	it( 'logs in when not authenticated', async () => {
		const authenticate = jest.fn();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false, authenticate } );
		renderWithProvider( <UserSettings /> );
		const loginButton = screen.getByRole( 'button', { name: 'Log in' } );
		expect( loginButton ).toBeVisible();
		fireEvent.click( loginButton );
		expect( authenticate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'logs out if authenticated', async () => {
		const logout = jest.fn();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, logout } );
		renderWithProvider( <UserSettings /> );
		const logoutButton = screen.getByRole( 'button', { name: 'Log out' } );
		expect( logoutButton ).toBeVisible();
		fireEvent.click( logoutButton );
		expect( logout ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'disables log in button when offline', async () => {
		const authenticate = jest.fn();
		( useOffline as jest.Mock ).mockReturnValue( true );
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false, authenticate } );
		renderWithProvider( <UserSettings /> );
		const loginButton = screen.getByRole( 'button', { name: 'Log in' } );
		expect( loginButton ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.click( loginButton );
		expect( authenticate ).not.toHaveBeenCalled();
		fireEvent.mouseOver( loginButton );
		expect(
			screen.getByRole( 'tooltip', {
				name: 'You’re currently offline.',
			} )
		).toBeVisible();
	} );
} );
