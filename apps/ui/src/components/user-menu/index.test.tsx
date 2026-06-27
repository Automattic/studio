import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { UserMenu } from './index';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

const navigate = vi.fn();
const loginMutate = vi.fn();
let pathname = '/';

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigate,
	useRouterState: ( {
		select,
	}: {
		select: ( state: { location: { pathname: string } } ) => unknown;
	} ) => select( { location: { pathname } } ),
} ) );

vi.mock( '@wordpress/ui', () => ( {
	Button: ( {
		children,
		tone,
		variant,
		size,
		nativeButton,
		...props
	}: ButtonHTMLAttributes< HTMLButtonElement > & {
		children?: ReactNode;
		tone?: string;
		variant?: string;
		size?: string;
		nativeButton?: boolean;
	} ) => {
		void tone;
		void variant;
		void size;
		void nativeButton;
		return <button { ...props }>{ children }</button>;
	},
	IconButton: ( {
		label,
		icon,
		tone,
		variant,
		size,
		...props
	}: ButtonHTMLAttributes< HTMLButtonElement > & {
		label: string;
		icon?: unknown;
		tone?: string;
		variant?: string;
		size?: string;
	} ) => {
		void icon;
		void tone;
		void variant;
		void size;
		return (
			<button type="button" aria-label={ label } { ...props }>
				{ label }
			</button>
		);
	},
} ) );

vi.mock( '@/components/gravatar', () => ( {
	Gravatar: () => <span data-testid="gravatar" />,
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: vi.fn(),
	useLogin: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: vi.fn(),
} ) );

vi.mock( '@/hooks/use-prefers-color-scheme', () => ( {
	usePrefersColorScheme: () => 'dark',
} ) );

const useAuthUserMock = vi.mocked( useAuthUser );
const useLoginMock = vi.mocked( useLogin );
const useUserPreferencesMock = vi.mocked( useUserPreferences );

describe( 'UserMenu', () => {
	beforeEach( () => {
		pathname = '/';
		navigate.mockClear();
		loginMutate.mockClear();
		useLoginMock.mockReturnValue( {
			mutate: loginMutate,
		} as unknown as ReturnType< typeof useLogin > );
		useUserPreferencesMock.mockReturnValue( {
			data: { colorScheme: 'system' },
		} as ReturnType< typeof useUserPreferences > );
	} );

	it( 'opens account settings directly for signed-in users', () => {
		useAuthUserMock.mockReturnValue( {
			data: { displayName: 'Ada Lovelace', email: 'ada@example.com' },
		} as ReturnType< typeof useAuthUser > );

		render( <UserMenu /> );

		expect( screen.queryByRole( 'button', { name: 'Appearance' } ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Open account settings' } ) );

		expect( navigate ).toHaveBeenCalledWith( {
			to: '/settings',
		} );
	} );

	it( 'highlights the signed-in account row while settings is active', () => {
		pathname = '/settings';
		useAuthUserMock.mockReturnValue( {
			data: { displayName: 'Ada Lovelace', email: 'ada@example.com' },
		} as ReturnType< typeof useAuthUser > );

		render( <UserMenu /> );

		expect( screen.getByRole( 'button', { name: 'Open account settings' } ) ).toHaveAttribute(
			'aria-current',
			'page'
		);
	} );

	it( 'keeps settings reachable when signed out', () => {
		useAuthUserMock.mockReturnValue( { data: undefined } as ReturnType< typeof useAuthUser > );

		render( <UserMenu /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Settings' } ) );

		expect( navigate ).toHaveBeenCalledWith( {
			to: '/settings',
		} );
		expect( screen.queryByRole( 'button', { name: 'Appearance' } ) ).not.toBeInTheDocument();
	} );
} );
