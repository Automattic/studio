import '@testing-library/jest-dom/vitest';
import { supportedLocaleNames } from '@studio/common/lib/locale';
import { supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { persister } from '@/data/core/query-client';
import { useInstalledApps } from '@/data/queries/use-installed-apps';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { SIDEBAR_PANEL_STORAGE_KEY } from '@/data/resizable-panels';
import { AppearanceSettings, GeneralSettings } from './index';

vi.mock( './sidebar-settings', () => ( {
	SidebarSettings: () => null,
} ) );

vi.mock( '@/features/account/gravatar', () => ( {
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

vi.mock( '@/data/host/use-color-scheme', () => ( {
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

const SAVED = {
	editor: null,
	terminal: 'terminal',
	colorScheme: 'system',
	quitSitesBehavior: undefined,
	locale: 'en',
	defaultSiteDirectory: '/Users/example/Studio',
	studioCliInstalled: false,
	studioCliExternallyManaged: false,
};

function mockPreferences( preferences: object ) {
	useUserPreferencesMock.mockReturnValue( {
		data: { ...SAVED, ...preferences },
		isLoading: false,
	} as never );
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
		mockPreferences( {} );
	} );

	it( 'saves the theme as soon as one is picked', async () => {
		render( <AppearanceSettings /> );

		await pick( 'Theme', 'Dark' );

		await waitFor( () =>
			expect( mutate ).toHaveBeenCalledWith( { colorScheme: 'dark' }, expect.any( Object ) )
		);
	} );

	it( 'tints the app with a color preset and saves it', () => {
		render( <AppearanceSettings /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Green' } ) );

		expect( mutate ).toHaveBeenCalledWith( {
			accentColor: '#069e08',
			tintIntensity: 20,
			contrast: 0,
		} );
		const root = document.documentElement.style;
		expect( Number( root.getPropertyValue( '--tint-hue' ) ) ).toBeCloseTo( 142.6, 1 );
		expect( root.getPropertyValue( '--tint-intensity' ) ).toBe( '20' );
		expect( screen.getByRole( 'button', { name: 'Green' } ) ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	} );

	it( 'saves a typed hex color once it is complete', () => {
		render( <AppearanceSettings /> );
		const input = screen.getByRole( 'textbox', { name: 'Hex color' } );

		fireEvent.change( input, { target: { value: 'FF99' } } );
		expect( mutate ).not.toHaveBeenCalled();
		fireEvent.change( input, { target: { value: 'FF9900' } } );

		expect( mutate ).toHaveBeenCalledWith( {
			accentColor: '#ff9900',
			tintIntensity: 0,
			contrast: 0,
		} );
	} );

	it( 'restores the default color, intensity, and contrast, and only when one changed', () => {
		const { unmount } = render( <AppearanceSettings /> );
		expect( screen.getByRole( 'button', { name: 'Reset' } ) ).toBeDisabled();
		unmount();

		mockPreferences( { accentColor: '#8c52d9', tintIntensity: 40, contrast: 30 } );
		render( <AppearanceSettings /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'Reset' } ) );

		expect( mutate ).toHaveBeenCalledWith( {
			accentColor: '#3858e9',
			tintIntensity: 0,
			contrast: 0,
		} );
		const root = document.documentElement.style;
		expect( root.getPropertyValue( '--tint-hue' ) ).toBe( '260' );
		expect( root.getPropertyValue( '--contrast' ) ).toBe( '0' );
	} );

	it( 'offers Default, the installed editors, and a saved one that is gone', async () => {
		mockPreferences( { editor: 'cursor' } );
		render( <GeneralSettings /> );

		fireEvent.click( screen.getByRole( 'combobox', { name: 'Code editor' } ) );
		const options = await screen.findAllByRole( 'option' );
		expect( options.map( ( option ) => option.textContent ) ).toEqual( [
			'Default',
			supportedEditorConfig.cursor.label(),
			supportedEditorConfig.vscode.label(),
		] );
		choose( options[ 0 ] );
		await waitFor( () =>
			expect( mutate ).toHaveBeenCalledWith( { editor: null }, expect.any( Object ) )
		);
	} );

	it( 'resets the interface preferences and panel widths, and only when something changed', () => {
		const { unmount } = render( <GeneralSettings /> );
		expect( screen.getByRole( 'button', { name: 'Reset interface' } ) ).toBeDisabled();
		unmount();

		mockPreferences( { newSiteBehavior: 'blank' } );
		window.localStorage.setItem( SIDEBAR_PANEL_STORAGE_KEY, '320' );
		mutate.mockImplementation( ( _patch, options ) => options?.onSuccess?.() );
		render( <GeneralSettings /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Reset interface' } ) );

		expect( mutate ).toHaveBeenCalledWith(
			{
				colorScheme: 'system',
				quitSitesBehavior: null,
				autoStartSiteOnChat: false,
				confirmDeleteAnnotations: true,
				showRecentChats: true,
				autoCollapseSites: true,
				newSiteBehavior: 'choose',
				accentColor: '#3858e9',
				tintIntensity: 0,
				contrast: 0,
			},
			expect.any( Object )
		);
		expect( window.localStorage.getItem( SIDEBAR_PANEL_STORAGE_KEY ) ).toBeNull();
	} );

	it( 'turns the annotation delete confirmation back on', () => {
		mockPreferences( { confirmDeleteAnnotations: false } );
		render( <GeneralSettings /> );

		fireEvent.click(
			screen.getByRole( 'switch', { name: 'Confirm before deleting annotations' } )
		);

		expect( mutate ).toHaveBeenCalledWith(
			{ confirmDeleteAnnotations: true },
			expect.any( Object )
		);
	} );

	it( 'saves a typed default directory where there is no folder picker', () => {
		useConnectorMock.mockReturnValue( { capabilities: { nativeFolderPicker: false } } as never );
		render( <GeneralSettings /> );

		fireEvent.change( screen.getByRole( 'textbox', { name: 'Default directory' } ), {
			target: { value: ' /Users/example/Sites ' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		expect( mutate ).toHaveBeenCalledWith(
			{ defaultSiteDirectory: '/Users/example/Sites' },
			expect.any( Object )
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
