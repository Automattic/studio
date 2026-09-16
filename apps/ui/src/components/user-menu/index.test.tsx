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
	beforeEach( () => {
		vi.clearAllMocks();

		useAuthUserMock.mockReturnValue( {
			data: { id: 1, displayName: 'Ada Lovelace', email: 'ada@example.com' },
		} as never );
	} );

	it( 'opens Settings directly and shows the gravatar when signed in', () => {
		render( <UserMenu /> );

		expect( screen.getByTestId( 'gravatar' ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'App settings' } ) );

		expect( navigateMock ).toHaveBeenCalledWith( { to: '/settings' } );
	} );

	it( 'opens Settings directly with a placeholder icon when signed out', () => {
		useAuthUserMock.mockReturnValue( { data: null } as never );

		render( <UserMenu /> );

		expect( screen.queryByTestId( 'gravatar' ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'App settings' } ) );

		expect( navigateMock ).toHaveBeenCalledWith( { to: '/settings' } );
	} );

	it( 'leaves the sidebar toggle to the panel', () => {
		render( <UserMenu /> );

		expect( screen.queryByRole( 'button', { name: 'Hide sidebar' } ) ).not.toBeInTheDocument();
	} );
} );
