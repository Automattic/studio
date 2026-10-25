import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WelcomeDialog } from './index';

const state = vi.hoisted( () => ( {
	user: null as null | { email: string; displayName: string },
	login: { isPending: false, error: null, mutate: vi.fn(), reset: vi.fn() },
	navigate: vi.fn(),
	setOnboardingCompleted: vi.fn( async () => undefined ),
} ) );

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => state.navigate,
	useSearch: () => ( { welcome: true } ),
} ) );
vi.mock( '@/data/core', () => ( {
	useConnector: () => ( {
		setOnboardingCompleted: state.setOnboardingCompleted,
		openExternalUrl: vi.fn(),
	} ),
} ) );
vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: () => ( { data: state.user } ),
	useLogin: () => state.login,
	useLogout: () => ( { isPending: false, mutate: vi.fn() } ),
} ) );
vi.mock( '@/data/queries/use-user-locale', () => ( { useUserLocale: () => 'en' } ) );
vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: () => ( { data: { analyticsEnabled: true } } ),
	useSaveUserPreferences: () => ( { mutate: vi.fn() } ),
} ) );
vi.mock( '@/data/host/use-color-scheme', () => ( { useColorScheme: () => 'light' } ) );

describe( 'WelcomeDialog', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		state.user = null;
		state.login.isPending = false;
	} );

	it( 'says what a WordPress.com account adds, and continues without one to Add site', async () => {
		render( <WelcomeDialog /> );

		expect( screen.getByText( 'With a free WordPress.com account' ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Log in with WordPress.com' } ) );
		expect( state.login.mutate ).toHaveBeenCalled();

		fireEvent.click( screen.getByRole( 'button', { name: 'Continue without an account' } ) );
		await waitFor( () => expect( state.navigate ).toHaveBeenCalled() );
		expect( state.setOnboardingCompleted ).toHaveBeenCalledWith( true );
		const { search } = state.navigate.mock.calls[ 0 ][ 0 ];
		expect( search( { welcome: true } ) ).toEqual( { welcome: undefined, addSite: 'create' } );
	} );

	it( 'waits on the browser login, which can be cancelled', () => {
		state.login.isPending = true;
		render( <WelcomeDialog /> );

		expect(
			screen.getByRole( 'button', { name: /Finish logging in in your browser/ } )
		).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		expect( state.login.reset ).toHaveBeenCalled();
	} );

	it( 'shows who is signed in, with Continue', () => {
		state.user = { email: 'ada@example.com', displayName: 'Ada Lovelace' };
		render( <WelcomeDialog /> );

		expect( screen.getByText( 'Ada Lovelace' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Continue' } ) ).toBeVisible();
		expect( screen.queryByText( 'With a free WordPress.com account' ) ).not.toBeInTheDocument();
	} );
} );
