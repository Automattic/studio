import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { UserMenu } from './index';

const navigateMock = vi.fn();

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigateMock,
} ) );

vi.mock( '@/components/gravatar', () => ( {
	Gravatar: () => <span data-testid="gravatar" />,
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: vi.fn(),
} ) );

vi.mock( '@/hooks/use-color-scheme', () => ( {
	useColorScheme: () => 'light',
} ) );

const useAuthUserMock = vi.mocked( useAuthUser );

describe( 'UserMenu', () => {
	const onToggleSidebar = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();

		useAuthUserMock.mockReturnValue( {
			data: { id: 1, displayName: 'Ada Lovelace', email: 'ada@example.com' },
		} as never );
	} );

	it( 'opens Settings directly and shows the gravatar when signed in', () => {
		render( <UserMenu onToggleSidebar={ onToggleSidebar } /> );

		expect( screen.getByTestId( 'gravatar' ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Settings' } ) );

		expect( navigateMock ).toHaveBeenCalledWith( { to: '/settings' } );
	} );

	it( 'opens Settings directly with a placeholder icon when signed out', () => {
		useAuthUserMock.mockReturnValue( { data: null } as never );

		render( <UserMenu onToggleSidebar={ onToggleSidebar } /> );

		expect( screen.queryByTestId( 'gravatar' ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Settings' } ) );

		expect( navigateMock ).toHaveBeenCalledWith( { to: '/settings' } );
	} );

	it( 'shows the Settings icon when a signed-in user has no email', () => {
		useAuthUserMock.mockReturnValue( {
			data: { id: 1, displayName: 'Ada Lovelace', email: '' },
		} as never );

		render( <UserMenu onToggleSidebar={ onToggleSidebar } /> );

		expect( screen.queryByTestId( 'gravatar' ) ).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Settings' } ).querySelector( 'svg' )
		).toBeInTheDocument();
	} );

	it( 'toggles the sidebar from the hide control', () => {
		render( <UserMenu onToggleSidebar={ onToggleSidebar } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Hide sidebar' } ) );

		expect( onToggleSidebar ).toHaveBeenCalledTimes( 1 );
		expect( navigateMock ).not.toHaveBeenCalled();
	} );
} );
