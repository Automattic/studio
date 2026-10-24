import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useOffline } from '@/lib/hooks';
import { AccountSection } from './account-section';

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: vi.fn(),
	useLogin: vi.fn(),
	useLogout: vi.fn(),
} ) );

vi.mock( '@/lib/hooks/use-offline', () => ( {
	useOffline: vi.fn(),
} ) );

const useAuthUserMock = vi.mocked( useAuthUser );
const useLoginMock = vi.mocked( useLogin );
const useLogoutMock = vi.mocked( useLogout );
const useOfflineMock = vi.mocked( useOffline );

describe( 'AccountSection', () => {
	const loginMutate = vi.fn();
	const logoutMutate = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();

		useOfflineMock.mockReturnValue( false );
		useAuthUserMock.mockReturnValue( {
			data: { id: 1, displayName: 'Ada Lovelace', email: 'ada@example.com' },
			isLoading: false,
		} as never );
		useLoginMock.mockReturnValue( { mutate: loginMutate, isPending: false } as never );
		useLogoutMock.mockReturnValue( { mutate: logoutMutate, isPending: false } as never );
	} );

	it( 'shows the signed-in user and logs out on request', () => {
		render( <AccountSection /> );

		expect( screen.getByText( 'Ada Lovelace' ) ).toBeInTheDocument();
		expect( screen.getByText( 'ada@example.com' ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Log in' } ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Log out' } ) );

		expect( logoutMutate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'offers signed-out users to connect through WordPress.com sign-up', () => {
		useAuthUserMock.mockReturnValue( { data: null, isSuccess: true } as never );

		render( <AccountSection /> );

		expect( screen.getByText( 'Do more with WordPress.com' ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Log out' } ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Connect' } ) );

		expect( useLoginMock ).toHaveBeenCalledWith( { signup: true, source: 'settings' } );
		expect( loginMutate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'disables Connect when offline', () => {
		useAuthUserMock.mockReturnValue( { data: null, isSuccess: true } as never );
		useOfflineMock.mockReturnValue( true );

		render( <AccountSection /> );

		expect( screen.getByRole( 'button', { name: 'Connect' } ) ).toBeDisabled();
	} );
} );
