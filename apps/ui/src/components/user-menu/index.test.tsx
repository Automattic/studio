import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/data/app-messages';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { UserMenu } from './index';

const navigateMock = vi.fn();
const logoutMock = vi.fn();

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigateMock,
} ) );

vi.mock( '@/components/gravatar', () => ( {
	Gravatar: () => <span data-testid="gravatar" />,
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: vi.fn(),
	useLogout: () => ( { mutate: logoutMock } ),
} ) );

vi.mock( '@/components/account-prompt', () => ( {
	AccountPromptDialog: ( { open, title }: { open: boolean; title: string } ) =>
		open ? <div role="dialog" aria-label={ title } /> : null,
} ) );

vi.mock( '@/data/app-messages', () => ( { toast: { error: vi.fn() } } ) );

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

		expect( navigateMock.mock.lastCall?.[ 0 ].search( {} ) ).toEqual( { settings: 'general' } );
	} );

	it( 'offers logging out from the account menu when signed in', async () => {
		render( <UserMenu /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Account' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Log out' } ) );

		expect( logoutMock ).toHaveBeenCalled();
	} );

	it( 'opens the Create account / Log in prompt from the account menu when signed out', async () => {
		useAuthUserMock.mockReturnValue( { data: null } as never );
		render( <UserMenu /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Account' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Log in' } ) );

		expect(
			await screen.findByRole( 'dialog', { name: 'Do more with WordPress.com' } )
		).toBeInTheDocument();
		expect( screen.queryByRole( 'menuitem', { name: 'Usage' } ) ).not.toBeInTheDocument();
	} );

	it( 'opens AI Providers from the account menu', async () => {
		render( <UserMenu /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Account' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'AI Providers' } ) );

		expect( navigateMock.mock.lastCall?.[ 0 ].search( {} ) ).toMatchObject( { settings: 'ai' } );
	} );

	it( 'reports a failed log out in a toast', async () => {
		logoutMock.mockImplementation( ( _variables, { onError } ) =>
			onError( new Error( 'Network down' ) )
		);
		render( <UserMenu /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Account' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Log out' } ) );

		expect( toast.error ).toHaveBeenCalledWith( 'Could not log out.', {
			description: 'Network down',
		} );
	} );

	it( 'shows an account error as an alert', () => {
		useAuthUserMock.mockReturnValue( {
			data: undefined,
			error: new Error( 'Session expired' ),
		} as never );
		render( <UserMenu /> );

		expect( screen.getByRole( 'alert' ) ).toHaveTextContent( 'Session expired' );
	} );
} );
