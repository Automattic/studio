// To run tests, execute `npm run test -- src/components/user-settings.test.tsx` from the root directory
import { fireEvent, render, screen } from '@testing-library/react';
import UserSettings from 'src/components/user-settings';
import { useAuth } from 'src/hooks/use-auth';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useOffline } from 'src/hooks/use-offline';

jest.mock( 'src/hooks/use-feature-flags' );
jest.mock( 'src/hooks/use-auth' );
jest.mock( 'src/hooks/use-ipc-listener' );

afterEach( () => {
	jest.clearAllMocks();
} );

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
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			preferredEditor: false,
		} );
		render( <UserSettings /> );
		const loginButton = screen.getByRole( 'button', { name: 'Log in' } );
		expect( loginButton ).toBeVisible();
		fireEvent.click( loginButton );
		expect( authenticate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'logs out if authenticated', async () => {
		const logout = jest.fn();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, logout } );
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			preferredEditor: false,
		} );
		render( <UserSettings /> );
		const logoutButton = screen.getByRole( 'button', { name: 'Log out' } );
		expect( logoutButton ).toBeVisible();
		fireEvent.click( logoutButton );
		expect( logout ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'disables log in button when offline', async () => {
		const authenticate = jest.fn();
		( useOffline as jest.Mock ).mockReturnValue( true );
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			preferredEditor: false,
		} );
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false, authenticate } );
		render( <UserSettings /> );
		const loginButton = screen.getByRole( 'button', { name: 'Log in' } );
		expect( loginButton ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.click( loginButton );
		expect( authenticate ).not.toHaveBeenCalled();
		fireEvent.mouseOver( loginButton );
		expect(
			screen.getByRole( 'tooltip', {
				name: "You're currently offline.",
			} )
		).toBeVisible();
	} );

	describe( 'Tab Navigation', () => {
		it( 'switches between tabs correctly', async () => {
			( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
			( useFeatureFlags as jest.Mock ).mockReturnValue( {
				preferredEditor: true,
			} );

			render( <UserSettings /> );

			// Check initial tab
			expect( screen.getByText( 'Account' ) ).toHaveAttribute( 'aria-selected', 'true' );
			expect( screen.getByText( 'Log out' ) ).toBeVisible();

			// Switch to Preferences tab
			fireEvent.click( screen.getByText( 'Preferences' ) );
			expect( screen.getByText( 'Preferences' ) ).toHaveAttribute( 'aria-selected', 'true' );
			expect( screen.getByText( 'Language' ) ).toBeVisible();
			expect( screen.getByText( 'Shell' ) ).toBeVisible();

			// Switch to Usage tab
			fireEvent.click( screen.getByText( 'Usage' ) );
			expect( screen.getByText( 'Usage' ) ).toHaveAttribute( 'aria-selected', 'true' );
			expect( screen.getByText( 'Preview sites' ) ).toBeVisible();
			expect( screen.getByText( 'AI assistant' ) ).toBeVisible();
		} );
	} );
} );
