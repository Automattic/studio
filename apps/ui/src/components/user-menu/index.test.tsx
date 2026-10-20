import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { UserMenu } from './index';

const navigateMock = vi.fn();
const loginMock = vi.fn();
const logoutMock = vi.fn();

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigateMock,
} ) );

vi.mock( '@/components/gravatar', () => ( {
	Gravatar: () => <span data-testid="gravatar" />,
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: vi.fn(),
	useLogin: () => ( { mutate: loginMock } ),
	useLogout: () => ( { mutate: logoutMock } ),
} ) );

vi.mock( '@/hooks/use-color-scheme', () => ( {
	useColorScheme: () => 'light',
} ) );

const useAuthUserMock = vi.mocked( useAuthUser );

describe( 'UserMenu', () => {
	beforeEach( () => {
		vi.clearAllMocks();

		useAuthUserMock.mockReturnValue( {
			data: { id: 1, displayName: 'Ada Lovelace', email: 'ada@example.com' },
		} as never );
	} );

	it( 'opens Settings from its button', () => {
		render( <UserMenu /> );

		expect( screen.getByTestId( 'gravatar' ) ).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Settings' } ) );

		expect( navigateMock ).toHaveBeenCalledWith( { to: '/settings' } );
	} );

	it( 'offers logging out from the account menu when signed in', async () => {
		render( <UserMenu /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Account' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Log out' } ) );

		expect( logoutMock ).toHaveBeenCalled();
	} );

	it( 'offers logging in from the account menu when signed out', async () => {
		useAuthUserMock.mockReturnValue( { data: null } as never );
		render( <UserMenu /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Account' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Log in' } ) );

		expect( loginMock ).toHaveBeenCalled();
	} );
} );
