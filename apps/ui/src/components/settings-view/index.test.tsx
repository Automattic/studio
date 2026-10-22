import '@testing-library/jest-dom/vitest';
import { supportedLocaleNames } from '@studio/common/lib/locale';
import { supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { persister } from '@/data/core/query-client';
import { useInstalledApps } from '@/data/queries/use-installed-apps';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { AppearanceSettings, GeneralSettings } from './index';

vi.mock( '@/components/site-list/sidebar-settings', () => ( { SidebarSettings: () => null } ) );

vi.mock( '@/components/gravatar', () => ( {
	Gravatar: () => <span data-testid="gravatar" />,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( './ai-panel', () => ( {
	AiPanel: () => <div data-testid="ai-panel" />,
} ) );

vi.mock( './skills-panel', () => ( {
	SkillsPanel: () => null,
} ) );

vi.mock( './studio-cli-section', () => ( {
	StudioCliSection: () => null,
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: () => ( { data: null, isLoading: false } ),
	useLogin: () => ( { mutate: vi.fn(), isPending: false } ),
	useLogout: () => ( { mutate: vi.fn(), isPending: false } ),
} ) );

vi.mock( '@/hooks/use-color-scheme', () => ( {
	useColorScheme: () => 'light',
} ) );

vi.mock( './mcp-panel', () => ( {
	McpPanel: () => <div data-testid="mcp-panel" />,
} ) );

vi.mock( '@/data/core/query-client', () => ( {
	persister: { removeClient: vi.fn( () => Promise.resolve() ) },
} ) );

vi.mock( '@/data/queries/use-installed-apps', () => ( {
	useInstalledApps: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useSaveUserPreferences: vi.fn(),
	useUserPreferences: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-wapuu-score', () => ( {
	useWapuuScore: () => ( { data: null } ),
} ) );

vi.mock( './usage-panel', () => ( {
	UsagePanel: () => null,
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useInstalledAppsMock = vi.mocked( useInstalledApps );
const useSaveUserPreferencesMock = vi.mocked( useSaveUserPreferences );
const useUserPreferencesMock = vi.mocked( useUserPreferences );
const removeClientMock = vi.mocked( persister.removeClient );

function choose( item: HTMLElement ) {
	fireEvent.pointerDown( item, { pointerType: 'mouse' } );
	fireEvent.click( item );
}

async function pick( name: string, option: string ) {
	fireEvent.click( screen.getByRole( 'combobox', { name } ) );
	choose( await screen.findByRole( 'option', { name: option } ) );
}

describe( 'Studio settings', () => {
	const mutate = vi.fn();
	const reload = vi.fn();
	const selectDefaultSiteDirectory = vi.fn( () => Promise.resolve< string | null >( null ) );

	beforeEach( () => {
		vi.clearAllMocks();

		Object.defineProperty( window, 'location', {
			value: { reload },
			writable: true,
			configurable: true,
		} );

		useConnectorMock.mockReturnValue( {
			selectDefaultSiteDirectory,
			capabilities: { nativeFolderPicker: true },
		} as never );
		useInstalledAppsMock.mockReturnValue( {
			data: { vscode: true, terminal: true, iterm: true },
		} as never );
		useSaveUserPreferencesMock.mockReturnValue( {
			mutate,
			isPending: false,
			isError: false,
		} as never );
		useUserPreferencesMock.mockReturnValue( {
			data: {
				editor: null,
				terminal: 'terminal',
				colorScheme: 'system',
				quitSitesBehavior: undefined,
				locale: 'en',
				defaultSiteDirectory: '/Users/example/Studio',
				studioCliInstalled: false,
				studioCliExternallyManaged: false,
			},
			isLoading: false,
		} as never );
	} );

	it( 'saves the theme as soon as one is picked', async () => {
		render( <AppearanceSettings /> );

		await pick( 'Theme', 'Dark' );

		await waitFor( () =>
			expect( mutate ).toHaveBeenCalledWith( { colorScheme: 'dark' }, expect.any( Object ) )
		);
	} );

	it( 'saves the editor on change and only offers installed apps', async () => {
		render( <GeneralSettings /> );

		fireEvent.click( screen.getByRole( 'combobox', { name: 'Code editor' } ) );
		const options = await screen.findAllByRole( 'option' );
		expect( options.map( ( option ) => option.textContent ) ).toEqual( [
			supportedEditorConfig.vscode.label(),
		] );
		choose( options[ 0 ] );
		await waitFor( () =>
			expect( mutate ).toHaveBeenCalledWith( { editor: 'vscode' }, expect.any( Object ) )
		);
	} );

	it( 'clears the persisted cache and reloads after a locale change is saved', async () => {
		mutate.mockImplementation( ( patch, options ) => options?.onSuccess?.() );

		render( <GeneralSettings /> );

		await pick( 'Language', supportedLocaleNames.es );

		await waitFor( () =>
			expect( mutate ).toHaveBeenCalledWith( { locale: 'es' }, expect.any( Object ) )
		);
		await waitFor( () => expect( reload ).toHaveBeenCalled() );
		expect( removeClientMock ).toHaveBeenCalled();
	} );

	it( 'saves the default site directory as soon as one is picked', async () => {
		selectDefaultSiteDirectory.mockResolvedValue( '/Users/example/Sites' );

		render( <GeneralSettings /> );

		fireEvent.click( screen.getByRole( 'button', { name: /Default directory/ } ) );

		await waitFor( () =>
			expect( mutate ).toHaveBeenCalledWith(
				{ defaultSiteDirectory: '/Users/example/Sites' },
				expect.any( Object )
			)
		);
		expect( selectDefaultSiteDirectory ).toHaveBeenCalledWith( '/Users/example/Studio' );
	} );
} );
