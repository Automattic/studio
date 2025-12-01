// Run tests: yarn test -- src/components/onboarding.test.tsx
import { jest } from '@jest/globals';
import { render, waitFor, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { useOffline } from 'src/hooks/use-offline';
import { createTestStore } from 'src/lib/test-utils';
import { Onboarding } from 'src/modules/onboarding';
import { useOnboarding } from 'src/modules/onboarding/hooks/use-onboarding';

jest.mock( 'src/modules/onboarding/hooks/use-onboarding', () => ( {
	useOnboarding: jest.fn(),
} ) );

jest.mock( 'src/lib/app-globals', () => ( {
	isMac: () => true,
	isWindows: () => false,
} ) );

jest.mock( 'src/hooks/use-offline', () => ( {
	useOffline: jest.fn().mockReturnValue( false ),
} ) );

const mockSaveLastSeenVersion = jest.fn();

jest.mock( 'src/stores/app-version-api', () => {
	const actual = jest.requireActual( 'src/stores/app-version-api' ) || {};
	return {
		...actual,
		useSaveLastSeenVersionMutation: jest.fn( () => [ mockSaveLastSeenVersion ] ),
	};
} );

const mockSaveOnboarding = jest.fn();

jest.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: jest.fn( () => ( {
		saveOnboarding: mockSaveOnboarding,
	} ) ),
} ) );

const renderWithProvider = ( children: React.ReactElement ) => {
	const store = createTestStore();
	return render( <Provider store={ store }>{ children }</Provider> );
};

describe( 'Onboarding Component', () => {
	const user = userEvent.setup();

	beforeEach( () => {
		jest.clearAllMocks();
		mockSaveLastSeenVersion.mockResolvedValue( { data: undefined } as never );
		mockSaveOnboarding.mockResolvedValue( undefined as never );
		window.appGlobals = { appVersion: '1.0.0' } as typeof window.appGlobals;

		( useOnboarding as jest.Mock ).mockReturnValue( {
			needsOnboarding: true,
		} );
	} );

	it( 'renders onboarding screen correctly', () => {
		const { getByText } = renderWithProvider( <Onboarding /> );
		expect( getByText( 'Connect your WordPress.com account' ) ).toBeVisible();
		expect( getByText( 'Skip →' ) ).toBeVisible();
	} );

	it( 'completes onboarding when the final button is clicked', async () => {
		const { getByText } = renderWithProvider( <Onboarding /> );

		await user.click( getByText( 'Skip →' ) );

		await waitFor( () => {
			expect( mockSaveOnboarding ).toHaveBeenCalledWith( true );
		} );
	} );

	it( 'should show tooltip with offline message when hovering over disabled Login button', async () => {
		( useOffline as jest.Mock ).mockReturnValue( true );

		renderWithProvider( <Onboarding /> );
		const user = userEvent.setup();

		const logIn = screen.getByRole( 'button', { name: 'Log in to WordPress.com ↗' } );
		await user.hover( logIn );

		expect( screen.getByText( "You're currently offline." ) ).toBeInTheDocument();
	} );

	it( 'should not show tooltip when hovering over Login button while online', async () => {
		( useOffline as jest.Mock ).mockReturnValue( false );

		renderWithProvider( <Onboarding /> );
		const user = userEvent.setup();

		const logIn = screen.getByRole( 'button', { name: 'Log in to WordPress.com ↗' } );
		await user.hover( logIn );

		expect( screen.queryByText( "You're currently offline." ) ).not.toBeInTheDocument();
	} );

	it( 'should save the current app version when onboarding completes', async () => {
		const mockSaveLastSeenVersion = jest.fn();
		const mockAppVersion = '1.0.0';

		// Mock window.appGlobals
		window.appGlobals = { appVersion: mockAppVersion } as typeof window.appGlobals;

		const appVersionApi = jest.requireMock< {
			useSaveLastSeenVersionMutation: jest.Mock;
		} >( 'src/stores/app-version-api' );
		appVersionApi.useSaveLastSeenVersionMutation.mockReturnValue( [ mockSaveLastSeenVersion ] );

		const { getByText } = renderWithProvider( <Onboarding /> );

		await user.click( getByText( 'Skip →' ) );

		await waitFor( () => {
			expect( mockSaveLastSeenVersion ).toHaveBeenCalledWith( mockAppVersion );
		} );
	} );
} );
