import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAppGlobals } from '@/data/queries/use-app-globals';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useInstalledApps } from '@/data/queries/use-installed-apps';
import {
	useDeleteAllSnapshots,
	useSnapshotUsage,
	useSnapshots,
} from '@/data/queries/use-snapshots';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import {
	useInstallWordPressSkill,
	useRemoveWordPressSkill,
	useWordPressSkills,
} from '@/data/queries/use-wordpress-skills';
import { SettingsView } from './index';
import type { ReactNode } from 'react';

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

vi.mock( '@/data/queries/use-app-globals', () => ( {
	useAppGlobals: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-installed-apps', () => ( {
	useInstalledApps: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-snapshots', () => ( {
	useDeleteAllSnapshots: vi.fn(),
	useSnapshotUsage: vi.fn(),
	useSnapshots: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useSaveUserPreferences: vi.fn(),
	useUserPreferences: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-wordpress-skills', () => ( {
	useInstallWordPressSkill: vi.fn(),
	useRemoveWordPressSkill: vi.fn(),
	useWordPressSkills: vi.fn(),
} ) );

vi.mock( '@/hooks/use-prefers-color-scheme', () => ( {
	usePrefersColorScheme: () => 'dark',
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useAppGlobalsMock = vi.mocked( useAppGlobals );
const useAuthUserMock = vi.mocked( useAuthUser );
const useLoginMock = vi.mocked( useLogin );
const useLogoutMock = vi.mocked( useLogout );
const useInstalledAppsMock = vi.mocked( useInstalledApps );
const useDeleteAllSnapshotsMock = vi.mocked( useDeleteAllSnapshots );
const useSnapshotUsageMock = vi.mocked( useSnapshotUsage );
const useSnapshotsMock = vi.mocked( useSnapshots );
const useSaveUserPreferencesMock = vi.mocked( useSaveUserPreferences );
const useUserPreferencesMock = vi.mocked( useUserPreferences );
const useInstallWordPressSkillMock = vi.mocked( useInstallWordPressSkill );
const useRemoveWordPressSkillMock = vi.mocked( useRemoveWordPressSkill );
const useWordPressSkillsMock = vi.mocked( useWordPressSkills );

describe( 'SettingsView', () => {
	const openExternalUrl = vi.fn();
	const loginMutate = vi.fn();
	const logoutMutate = vi.fn();

	beforeEach( () => {
		Object.defineProperty( window, 'matchMedia', {
			writable: true,
			value: vi.fn().mockImplementation( ( query: string ) => ( {
				matches: false,
				media: query,
				onchange: null,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				addListener: vi.fn(),
				removeListener: vi.fn(),
				dispatchEvent: vi.fn(),
			} ) ),
		} );
		openExternalUrl.mockResolvedValue( undefined );
		loginMutate.mockReset();
		logoutMutate.mockReset();
		useConnectorMock.mockReturnValue( {
			isFullscreen: vi.fn().mockResolvedValue( false ),
			onFullscreenChange: vi.fn( () => vi.fn() ),
			openExternalUrl,
			previewColorScheme: vi.fn(),
			selectDefaultSiteDirectory: vi.fn(),
		} as never );
		useAuthUserMock.mockReturnValue( {
			data: {
				displayName: 'Shaun Andrews',
				email: 'shaun@example.com',
			},
		} as never );
		useLoginMock.mockReturnValue( { mutate: loginMutate, isPending: false } as never );
		useLogoutMock.mockReturnValue( { mutate: logoutMutate, isPending: false } as never );
		useAppGlobalsMock.mockReturnValue( { data: { isWindowsStore: false } } as never );
		useInstalledAppsMock.mockReturnValue( { data: {} } as never );
		useSnapshotsMock.mockReturnValue( { data: [], isLoading: false } as never );
		useSnapshotUsageMock.mockReturnValue( { data: null, isLoading: false } as never );
		useDeleteAllSnapshotsMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useSaveUserPreferencesMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
		useUserPreferencesMock.mockReturnValue( {
			data: {
				editor: null,
				terminal: null,
				colorScheme: 'system',
				defaultSiteDirectory: '/Users/example/Studio',
				messageSendShortcut: 'mod-enter',
				studioCliInstalled: false,
				locale: 'en',
			},
			isLoading: false,
		} as never );
		useWordPressSkillsMock.mockReturnValue( { data: [], isLoading: false } as never );
		useInstallWordPressSkillMock.mockReturnValue( {
			mutate: vi.fn(),
			mutateAsync: vi.fn(),
			isPending: false,
		} as never );
		useRemoveWordPressSkillMock.mockReturnValue( { mutate: vi.fn(), isPending: false } as never );
	} );

	afterEach( () => {
		vi.clearAllMocks();
	} );

	it( 'shows the account overview for a signed-in user', () => {
		render( <SettingsView activeTab="account" onTabChange={ vi.fn() } /> );

		expect( screen.getByText( 'Shaun Andrews' ) ).toBeInTheDocument();
		expect( screen.getByText( 'shaun@example.com' ) ).toBeInTheDocument();
		expect( screen.getByTestId( 'account-gravatar' ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Save' } ) ).not.toBeInTheDocument();

		expect(
			screen.getByText( 'Unlimited tokens while Studio Code is in beta.' )
		).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'link', { name: 'Documentation' } ) );
		expect( openExternalUrl ).toHaveBeenCalledWith(
			'https://developer.wordpress.com/docs/developer-tools/studio/'
		);

		fireEvent.click( screen.getByRole( 'link', { name: 'Report an issue' } ) );
		expect( openExternalUrl ).toHaveBeenCalledWith(
			'https://github.com/Automattic/studio/issues/new/choose'
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Log out' } ) );
		expect( logoutMutate ).toHaveBeenCalled();
	} );

	it( 'offers WordPress.com login from account settings when signed out', () => {
		useAuthUserMock.mockReturnValue( { data: null } as never );

		render( <SettingsView activeTab="account" onTabChange={ vi.fn() } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Log in' } ) );

		expect( loginMutate ).toHaveBeenCalled();
	} );

	it( 'opens preference dropdowns', async () => {
		const user = userEvent.setup();

		render( <SettingsView activeTab="preferences" onTabChange={ vi.fn() } /> );

		await user.click( screen.getByRole( 'combobox', { name: 'Language' } ) );

		expect( await screen.findByRole( 'option', { name: 'English' } ) ).toBeVisible();
	} );

	it( 'deletes preview sites from the preview actions menu', async () => {
		const user = userEvent.setup();
		const deleteMutate = vi.fn();
		const confirmSpy = vi.spyOn( window, 'confirm' ).mockReturnValue( true );

		useSnapshotUsageMock.mockReturnValue( {
			data: { siteCount: 1, siteLimit: 10, siteCreationBlocked: false },
			isLoading: false,
		} as never );
		useDeleteAllSnapshotsMock.mockReturnValue( {
			mutate: deleteMutate,
			isPending: false,
		} as never );

		render( <SettingsView activeTab="account" onTabChange={ vi.fn() } /> );

		await user.click( screen.getByRole( 'button', { name: 'Preview site actions' } ) );
		await user.click( await screen.findByRole( 'menuitem', { name: 'Delete all preview sites' } ) );

		expect( confirmSpy ).toHaveBeenCalledWith(
			'All preview sites that exist for your WordPress.com account, along with their posts, pages, comments, and media, will be lost.'
		);
		expect( deleteMutate ).toHaveBeenCalled();

		confirmSpy.mockRestore();
	} );
} );
