import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { UserMenu } from './index';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

const navigate = vi.fn();
const loginMutate = vi.fn();
const logoutMutate = vi.fn();
const savePreferencesMutate = vi.fn();
const openExternalUrl = vi.fn();
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

vi.mock( '@/components/menu', () => {
	let onRadioValueChange: ( ( value: string ) => void ) | undefined;

	return {
		Root: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
		Trigger: ( { render }: { render: ReactNode } ) => <>{ render }</>,
		Popup: ( { children }: { children: ReactNode } ) => <div role="menu">{ children }</div>,
		Item: ( { children, onClick }: { children: ReactNode; onClick?: () => void } ) => (
			<button type="button" onClick={ onClick }>
				{ children }
			</button>
		),
		Separator: () => <hr />,
		RadioGroup: ( {
			children,
			onValueChange,
		}: {
			children: ReactNode;
			value: string;
			onValueChange: ( value: string ) => void;
		} ) => {
			onRadioValueChange = onValueChange;
			return <div>{ children }</div>;
		},
		RadioItem: ( { children, value }: { children: ReactNode; value: string } ) => (
			<button type="button" onClick={ () => onRadioValueChange?.( value ) }>
				{ children }
			</button>
		),
	};
} );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: vi.fn(),
	useLogin: vi.fn(),
	useLogout: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useSaveUserPreferences: vi.fn(),
	useUserPreferences: vi.fn(),
} ) );

vi.mock( '@/hooks/use-prefers-color-scheme', () => ( {
	usePrefersColorScheme: () => 'dark',
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );
const useAuthUserMock = vi.mocked( useAuthUser );
const useLoginMock = vi.mocked( useLogin );
const useLogoutMock = vi.mocked( useLogout );
const useSaveUserPreferencesMock = vi.mocked( useSaveUserPreferences );
const useUserPreferencesMock = vi.mocked( useUserPreferences );

describe( 'UserMenu', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		pathname = '/';
		useConnectorMock.mockReturnValue( {
			openExternalUrl,
		} );
		useLoginMock.mockReturnValue( {
			mutate: loginMutate,
		} as unknown as ReturnType< typeof useLogin > );
		useLogoutMock.mockReturnValue( {
			mutate: logoutMutate,
		} as unknown as ReturnType< typeof useLogout > );
		useSaveUserPreferencesMock.mockReturnValue( {
			mutate: savePreferencesMutate,
		} as unknown as ReturnType< typeof useSaveUserPreferences > );
		useUserPreferencesMock.mockReturnValue( {
			data: { colorScheme: 'system' },
		} as ReturnType< typeof useUserPreferences > );
	} );

	it( 'opens settings for signed-in users', () => {
		useAuthUserMock.mockReturnValue( {
			data: { displayName: 'Ada Lovelace', email: 'ada@example.com' },
		} as ReturnType< typeof useAuthUser > );

		render( <UserMenu /> );

		expect( screen.getByTestId( 'gravatar' ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Settings' } ) );

		expect( navigate ).toHaveBeenCalledWith( {
			to: '/settings',
		} );
	} );

	it( 'leaves appearance controls to the settings screen', () => {
		useAuthUserMock.mockReturnValue( {
			data: { displayName: 'Ada Lovelace', email: 'ada@example.com' },
		} as ReturnType< typeof useAuthUser > );

		render( <UserMenu /> );

		expect( screen.queryByText( 'Appearance' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Dark' } ) ).not.toBeInTheDocument();
	} );

	it( 'keeps settings reachable when signed out', () => {
		useAuthUserMock.mockReturnValue( { data: undefined } as ReturnType< typeof useAuthUser > );

		render( <UserMenu /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Settings' } ) );

		expect( navigate ).toHaveBeenCalledWith( {
			to: '/settings',
		} );
	} );

	it( 'marks the settings row as current while the settings route is open', () => {
		useAuthUserMock.mockReturnValue( {
			data: { displayName: 'Ada Lovelace', email: 'ada@example.com' },
		} as ReturnType< typeof useAuthUser > );
		pathname = '/settings';

		render( <UserMenu /> );

		expect( screen.getByRole( 'button', { name: 'Settings' } ) ).toHaveAttribute(
			'aria-current',
			'page'
		);
	} );

	it( 'leaves the settings row unmarked on other routes', () => {
		useAuthUserMock.mockReturnValue( {
			data: { displayName: 'Ada Lovelace', email: 'ada@example.com' },
		} as ReturnType< typeof useAuthUser > );
		pathname = '/sessions/abc';

		render( <UserMenu /> );

		expect( screen.getByRole( 'button', { name: 'Settings' } ) ).not.toHaveAttribute(
			'aria-current'
		);
	} );

	it( 'keeps the sidebar toggle action in the footer row', () => {
		const onToggleSidebar = vi.fn();
		useAuthUserMock.mockReturnValue( {
			data: { displayName: 'Ada Lovelace', email: 'ada@example.com' },
		} as ReturnType< typeof useAuthUser > );

		render( <UserMenu onToggleSidebar={ onToggleSidebar } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Hide sidebar' } ) );

		expect( onToggleSidebar ).toHaveBeenCalledTimes( 1 );
	} );
} );
