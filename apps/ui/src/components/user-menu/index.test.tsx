import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { forwardRef, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { UserMenu } from './index';

const routerState = vi.hoisted( () => ( {
	pathname: '/settings',
	search: {} as Record< string, string >,
} ) );

vi.mock( '@tanstack/react-router', () => ( {
	Link: forwardRef<
		HTMLAnchorElement,
		{
			to: string;
			search?: Record< string, string >;
			className?: string;
			activeOptions?: { exact?: boolean; includeSearch?: boolean };
			activeProps?: { className?: string };
			children: ReactNode;
		}
	>( function MockLink( { to, search, className, activeOptions, activeProps, children }, ref ) {
		const pathMatches = activeOptions?.exact
			? routerState.pathname === to
			: routerState.pathname.startsWith( to );
		const searchMatches =
			activeOptions?.includeSearch === false ||
			Object.entries( search ?? {} ).every(
				( [ key, value ] ) => routerState.search[ key ] === value
			);

		return (
			<a
				ref={ ref }
				href={ to }
				className={ pathMatches && searchMatches ? activeProps?.className : className }
			>
				{ children }
			</a>
		);
	} ),
} ) );

vi.mock( '@/components/gravatar', () => ( {
	Gravatar: ( { className }: { className?: string } ) => (
		<span data-testid="user-menu-gravatar" className={ className } />
	),
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: vi.fn(),
	useLogin: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: vi.fn(),
} ) );

vi.mock( '@/hooks/use-prefers-color-scheme', () => ( {
	usePrefersColorScheme: () => 'light',
} ) );

vi.mock( './style.module.css', () => ( {
	default: {
		root: 'root',
		row: 'row',
		userTrigger: 'userTrigger',
		userTriggerActive: 'userTriggerActive',
		loginButton: 'loginButton',
		avatar: 'avatar',
		userName: 'userName',
	},
} ) );

const useAuthUserMock = vi.mocked( useAuthUser );
const useLoginMock = vi.mocked( useLogin );
const useUserPreferencesMock = vi.mocked( useUserPreferences );

describe( 'UserMenu', () => {
	beforeEach( () => {
		routerState.pathname = '/settings';
		routerState.search = {};
		useAuthUserMock.mockReturnValue( {
			data: {
				displayName: 'Shaun Andrews',
				email: 'shaun@example.com',
			},
		} as never );
		useLoginMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useUserPreferencesMock.mockReturnValue( {
			data: { colorScheme: 'system' },
		} as never );
	} );

	it.each( [ 'account', 'preferences', 'keyboard' ] )(
		'highlights the settings row when the %s settings tab is active',
		( tab ) => {
			routerState.search = { tab };

			render( <UserMenu /> );

			expect( screen.getByRole( 'link', { name: 'Shaun Andrews' } ) ).toHaveClass(
				'userTriggerActive'
			);
		}
	);

	it( 'does not highlight the settings row on other routes', () => {
		routerState.pathname = '/sites';

		render( <UserMenu /> );

		expect( screen.getByRole( 'link', { name: 'Shaun Andrews' } ) ).not.toHaveClass(
			'userTriggerActive'
		);
	} );
} );
