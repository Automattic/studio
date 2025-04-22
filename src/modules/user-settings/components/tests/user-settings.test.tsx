// To run tests, execute `npm run test -- src/modules/user-settings/components/tests/user-settings.test.tsx` from the root directory
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { useAuth } from 'src/hooks/use-auth';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useOffline } from 'src/hooks/use-offline';
import { UserSettings } from 'src/modules/user-settings';
import { store } from 'src/stores';
import { useGetSnapshotUsage } from 'src/stores/wpcom-api';

jest.mock( 'src/hooks/use-feature-flags' );
jest.mock( 'src/hooks/use-auth' );
jest.mock( 'src/hooks/use-ipc-listener' );
// Mock wpcomApi with a proper reducer to avoid Redux initialization errors
jest.mock( 'src/stores/wpcom-api', () => {
	type NextFn = ( action: unknown ) => unknown;
	type ActionType = unknown;

	const createApi = () => ( {
		reducer: () => ( {} ),
		reducerPath: 'wpcomApi',
		middleware: () => ( next: NextFn ) => ( action: ActionType ) => next( action ),
		endpoints: {},
		injectEndpoints: jest.fn(),
		util: {},
	} );

	return {
		wpcomApi: createApi(),
		setWpcomClient: jest.fn(),
		useGetWelcomeMessages: jest.fn(),
		useGetSnapshotUsage: jest.fn().mockReturnValue( {
			data: { siteCount: 2, siteLimit: 10, siteCreationBlocked: false },
			isLoading: false,
			refetch: jest.fn(),
		} ),
	};
} );
jest.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: jest.fn().mockReturnValue( {
		getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
		getInstalledTerminals: jest.fn().mockResolvedValue( {
			terminal: true,
			iterm: false,
		} ),
		getInstalledApps: jest.fn().mockResolvedValue( [ 'vscode', 'phpstorm' ] ),
	} ),
} ) );

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

	it( 'calls refetchSnapshotUsage when modal is opened', async () => {
		const refetchMock = jest.fn();
		( useGetSnapshotUsage as jest.Mock ).mockReturnValue( {
			data: { siteCount: 2, siteLimit: 10, siteCreationBlocked: false },
			isLoading: false,
			refetch: refetchMock,
		} );
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			preferredEditor: false,
		} );

		renderWithProvider( <UserSettings /> );
		// Verify refetch is called when settings modal is opened
		expect( refetchMock ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'logs in when not authenticated', async () => {
		const authenticate = jest.fn();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false, authenticate } );
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			preferredEditor: false,
		} );
		renderWithProvider( <UserSettings /> );
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
		renderWithProvider( <UserSettings /> );
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
		renderWithProvider( <UserSettings /> );
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

			renderWithProvider( <UserSettings /> );

			// Check initial tab
			expect( screen.getByText( 'Account' ) ).toHaveAttribute( 'aria-selected', 'true' );
			expect( screen.getByText( 'Log out' ) ).toBeVisible();

			// Switch to Preferences tab
			fireEvent.click( screen.getByText( 'Preferences' ) );
			await waitFor( () => {
				expect( screen.getByText( 'Preferences' ) ).toHaveAttribute( 'aria-selected', 'true' );
			} );
			expect( screen.getByText( 'Language' ) ).toBeVisible();
			expect( screen.getByText( 'Shell' ) ).toBeVisible();

			// Switch to Usage tab
			fireEvent.click( screen.getByText( 'Usage' ) );
			await waitFor( () => {
				expect( screen.getByText( 'Usage' ) ).toHaveAttribute( 'aria-selected', 'true' );
			} );
			expect( screen.getByText( 'Preview sites' ) ).toBeVisible();
			expect( screen.getByText( 'AI assistant' ) ).toBeVisible();
		} );
	} );
} );
