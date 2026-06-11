import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useInstalledApps } from '@/data/queries/use-installed-apps';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { SettingsView } from './index';
import type { ReactNode } from 'react';

vi.mock( '@wordpress/dataviews', () => ( {
	DataForm: () => <div data-testid="data-form" />,
} ) );

vi.mock( '@/components/gravatar', () => ( {
	Gravatar: ( { className }: { className?: string } ) => (
		<span data-testid="account-gravatar" className={ className } />
	),
} ) );

vi.mock( '@/components/tabs', () => ( {
	Root: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
	List: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
	Tab: ( { children }: { children: ReactNode } ) => <button type="button">{ children }</button>,
	Panel: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: vi.fn(),
	useLogin: vi.fn(),
	useLogout: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-installed-apps', () => ( {
	useInstalledApps: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useSaveUserPreferences: vi.fn(),
	useUserPreferences: vi.fn(),
} ) );

vi.mock( '@/hooks/use-fullscreen', () => ( {
	useFullscreen: () => false,
} ) );

vi.mock( '@/hooks/use-prefers-color-scheme', () => ( {
	usePrefersColorScheme: () => 'dark',
} ) );

vi.mock( '@/hooks/use-sidebar-collapsed', () => ( {
	useSidebarCollapsed: () => false,
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useAuthUserMock = vi.mocked( useAuthUser );
const useLoginMock = vi.mocked( useLogin );
const useLogoutMock = vi.mocked( useLogout );
const useInstalledAppsMock = vi.mocked( useInstalledApps );
const useSaveUserPreferencesMock = vi.mocked( useSaveUserPreferences );
const useUserPreferencesMock = vi.mocked( useUserPreferences );

describe( 'SettingsView', () => {
	const openExternalUrl = vi.fn();
	const loginMutate = vi.fn();
	const logoutMutate = vi.fn();

	beforeEach( () => {
		openExternalUrl.mockResolvedValue( undefined );
		loginMutate.mockReset();
		logoutMutate.mockReset();
		useConnectorMock.mockReturnValue( {
			openExternalUrl,
		} as never );
		useAuthUserMock.mockReturnValue( {
			data: {
				displayName: 'Shaun Andrews',
				email: 'shaun@example.com',
			},
		} as never );
		useLoginMock.mockReturnValue( { mutate: loginMutate, isPending: false } as never );
		useLogoutMock.mockReturnValue( { mutate: logoutMutate, isPending: false } as never );
		useInstalledAppsMock.mockReturnValue( { data: {} } as never );
		useSaveUserPreferencesMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useUserPreferencesMock.mockReturnValue( {
			data: {
				editor: null,
				terminal: null,
				colorScheme: 'system',
				locale: 'en',
			},
			isLoading: false,
		} as never );
	} );

	afterEach( () => {
		vi.clearAllMocks();
	} );

	it( 'shows the former gravatar menu actions in account settings', () => {
		render( <SettingsView activeTab="account" onTabChange={ vi.fn() } /> );

		expect( screen.getByText( 'Shaun Andrews' ) ).toBeInTheDocument();
		expect( screen.getByText( 'shaun@example.com' ) ).toBeInTheDocument();
		expect( screen.getByTestId( 'account-gravatar' ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Save settings' } ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Edit WordPress.com profile' } ) );
		expect( openExternalUrl ).toHaveBeenCalledWith( 'https://wordpress.com/me' );

		fireEvent.click( screen.getByRole( 'button', { name: 'Documentation' } ) );
		expect( openExternalUrl ).toHaveBeenCalledWith(
			'https://developer.wordpress.com/docs/developer-tools/studio/'
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Report an issue' } ) );
		expect( openExternalUrl ).toHaveBeenCalledWith(
			'https://github.com/Automattic/studio/issues/new/choose'
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Log out' } ) );
		expect( logoutMutate ).toHaveBeenCalled();
	} );

	it( 'offers WordPress.com login from account settings when signed out', () => {
		useAuthUserMock.mockReturnValue( { data: null } as never );

		render( <SettingsView activeTab="account" onTabChange={ vi.fn() } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Log in with WordPress.com' } ) );

		expect( loginMutate ).toHaveBeenCalled();
	} );
} );
