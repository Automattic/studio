import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useOffline } from '@/hooks/use-offline';
import { AccountSection } from './account-section';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

vi.mock( '@wordpress/ui', () => ( {
	Button: ( {
		children,
		loading,
		loadingAnnouncement,
		tone,
		variant,
		size,
		...props
	}: ButtonHTMLAttributes< HTMLButtonElement > & {
		children?: ReactNode;
		loading?: boolean;
		loadingAnnouncement?: string;
		tone?: string;
		variant?: string;
		size?: string;
	} ) => {
		void tone;
		void variant;
		void size;
		return <button { ...props }>{ loading ? loadingAnnouncement : children }</button>;
	},
	Tooltip: {
		Root: ( { children }: { children?: ReactNode } ) => <>{ children }</>,
		Trigger: ( { render }: { render?: ReactNode } ) => <>{ render }</>,
		Popup: () => null,
		Positioner: () => null,
	},
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: vi.fn(),
	useLogin: vi.fn(),
	useLogout: vi.fn(),
} ) );

vi.mock( '@/hooks/use-offline', () => ( {
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

	it( 'prompts signed-out users to log in', () => {
		useAuthUserMock.mockReturnValue( { data: null, isLoading: false } as never );

		render( <AccountSection /> );

		expect( screen.getByText( 'WordPress.com account' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Log in to use AI features and synchronize with live and preview sites.' )
		).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Log out' } ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Log in' } ) );

		expect( loginMutate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'disables the login button when offline', () => {
		useAuthUserMock.mockReturnValue( { data: null, isLoading: false } as never );
		useOfflineMock.mockReturnValue( true );

		render( <AccountSection /> );

		expect( screen.getByRole( 'button', { name: 'Log in' } ) ).toBeDisabled();
	} );
} );
