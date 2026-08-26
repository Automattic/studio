// Run tests: yarn test -- src/components/onboarding.test.tsx
import { render, waitFor, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { useOffline } from 'src/hooks/use-offline';
import { createTestStore } from 'src/lib/test-utils';
import { Onboarding } from 'src/modules/onboarding';
import { useOnboarding } from 'src/modules/onboarding/hooks/use-onboarding';

vi.mock( 'src/modules/onboarding/hooks/use-onboarding', () => ( {
	useOnboarding: vi.fn(),
} ) );

vi.mock( 'src/lib/app-globals', () => ( {
	isMac: () => true,
	isWindows: () => false,
	isLinux: () => false,
} ) );

vi.mock( 'src/hooks/use-offline', () => ( {
	useOffline: vi.fn().mockReturnValue( false ),
} ) );

const mockSaveLastSeenVersion = vi.fn();

vi.mock( 'src/stores/app-version-api', async () => {
	const actual = ( await vi.importActual( 'src/stores/app-version-api' ) ) || {};
	return {
		...actual,
		useSaveLastSeenVersionMutation: vi.fn( () => [
			mockSaveLastSeenVersion,
			{ isLoading: false, isSuccess: false, isError: false },
		] ),
	};
} );

const mockSaveOnboarding = vi.fn();
const mockOpenURL = vi.fn();

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: vi.fn( () => ( {
		saveOnboarding: mockSaveOnboarding,
		openURL: mockOpenURL,
	} ) ),
} ) );

const renderWithProvider = ( children: React.ReactElement ) => {
	const store = createTestStore();
	return render( <Provider store={ store }>{ children }</Provider> );
};

describe( 'Onboarding Component', () => {
	const user = userEvent.setup();

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( useOffline ).mockReturnValue( false );
		mockSaveLastSeenVersion.mockResolvedValue( { data: undefined } as never );
		mockSaveOnboarding.mockResolvedValue( undefined as never );
		window.appGlobals = { appVersion: '1.0.0' } as typeof window.appGlobals;

		vi.mocked( useOnboarding ).mockReturnValue( {
			needsOnboarding: true,
		} );
	} );

	it( 'renders onboarding screen correctly', () => {
		const { getByTestId } = renderWithProvider( <Onboarding /> );
		expect( getByTestId( 'onboarding-welcome-title' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Skip' } ) ).toBeVisible();
	} );

	it( 'completes onboarding when the skip button is clicked', async () => {
		renderWithProvider( <Onboarding /> );

		await user.click( screen.getByRole( 'button', { name: 'Skip' } ) );

		await waitFor( () => {
			expect( mockSaveOnboarding ).toHaveBeenCalledWith( true );
		} );
	} );

	it( 'should show tooltip with offline message when hovering over disabled Login button', async () => {
		vi.mocked( useOffline ).mockReturnValue( true );

		renderWithProvider( <Onboarding /> );
		const user = userEvent.setup();

		const logIn = screen.getByRole( 'button', { name: 'Log in to WordPress.com ↗' } );
		await user.hover( logIn );

		expect( screen.getByText( "You're currently offline." ) ).toBeInTheDocument();
	} );

	it( 'should not show tooltip when hovering over Login button while online', async () => {
		vi.mocked( useOffline ).mockReturnValue( false );

		renderWithProvider( <Onboarding /> );
		const user = userEvent.setup();

		const logIn = screen.getByRole( 'button', { name: 'Log in to WordPress.com ↗' } );
		await user.hover( logIn );

		expect( screen.queryByText( "You're currently offline." ) ).not.toBeInTheDocument();
	} );

	it( 'renders the Terms of Service and Privacy Policy links', () => {
		renderWithProvider( <Onboarding /> );

		expect( screen.getByTestId( 'onboarding-legal' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Terms of Service' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Privacy Policy' } ) ).toBeVisible();
	} );

	it( 'opens the Terms of Service URL when the link is clicked', async () => {
		renderWithProvider( <Onboarding /> );

		await user.click( screen.getByRole( 'button', { name: 'Terms of Service' } ) );

		expect( mockOpenURL ).toHaveBeenCalledWith( 'https://wordpress.com/tos/' );
	} );

	it( 'opens the Privacy Policy URL when the link is clicked', async () => {
		renderWithProvider( <Onboarding /> );

		await user.click( screen.getByRole( 'button', { name: 'Privacy Policy' } ) );

		expect( mockOpenURL ).toHaveBeenCalledWith( 'https://automattic.com/privacy/' );
	} );

	it( 'should save the current app version when onboarding completes', async () => {
		const mockAppVersion = '1.0.0';

		// Mock window.appGlobals
		window.appGlobals = { appVersion: mockAppVersion } as typeof window.appGlobals;

		renderWithProvider( <Onboarding /> );

		await user.click( screen.getByRole( 'button', { name: 'Skip' } ) );

		await waitFor( () => {
			expect( mockSaveLastSeenVersion ).toHaveBeenCalledWith( mockAppVersion );
		} );
	} );
} );
