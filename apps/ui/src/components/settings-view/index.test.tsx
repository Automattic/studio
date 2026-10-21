import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { persister } from '@/data/core/query-client';
import { useInstalledApps } from '@/data/queries/use-installed-apps';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { AppearanceSettings, GeneralSettings } from './index';
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
	SelectControl: ( {
		items = [],
		label,
		value,
		onValueChange,
	}: {
		items?: Array< { label: string; value: string | null } >;
		label: string;
		value?: { label: string; value: string | null } | null;
		onValueChange?: ( item: { label: string; value: string | null } | undefined ) => void;
	} ) => (
		<label>
			<span>{ label }</span>
			<select
				value={ value?.value ?? '' }
				onChange={ ( event ) =>
					onValueChange?.( items.find( ( item ) => item.value === event.target.value ) )
				}
			>
				{ items.map( ( item ) => (
					<option key={ item.value ?? 'null' } value={ item.value ?? '' }>
						{ item.label }
					</option>
				) ) }
			</select>
		</label>
	),
	Tooltip: {
		Root: ( { children }: { children?: ReactNode } ) => <>{ children }</>,
		Trigger: ( { render }: { render?: ReactNode } ) => <>{ render }</>,
		Popup: () => null,
		Positioner: () => null,
	},
} ) );

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

	it( 'saves the color scheme as soon as an appearance option is picked', () => {
		render( <AppearanceSettings /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Dark' } ) );

		expect( mutate ).toHaveBeenCalledWith( { colorScheme: 'dark' }, expect.any( Object ) );
		expect( screen.queryByRole( 'button', { name: /save/i } ) ).not.toBeInTheDocument();
	} );

	it( 'saves the editor on change and only offers installed apps', () => {
		render( <GeneralSettings /> );

		const editorSelect = screen.getByLabelText( 'Preferred editor' ) as HTMLSelectElement;
		expect( Array.from( editorSelect.options ).map( ( option ) => option.value ) ).toEqual( [
			'vscode',
		] );

		fireEvent.change( editorSelect, { target: { value: 'vscode' } } );

		expect( mutate ).toHaveBeenCalledWith( { editor: 'vscode' }, expect.any( Object ) );
	} );

	it( 'clears the persisted cache and reloads after a locale change is saved', async () => {
		mutate.mockImplementation( ( patch, options ) => options?.onSuccess?.() );

		render( <GeneralSettings /> );

		fireEvent.change( screen.getByLabelText( 'Language' ), { target: { value: 'es' } } );

		expect( mutate ).toHaveBeenCalledWith( { locale: 'es' }, expect.any( Object ) );
		await waitFor( () => expect( reload ).toHaveBeenCalled() );
		expect( removeClientMock ).toHaveBeenCalled();
	} );

	it( 'saves the default site directory as soon as one is picked', async () => {
		selectDefaultSiteDirectory.mockResolvedValue( '/Users/example/Sites' );

		render( <GeneralSettings /> );

		fireEvent.click( screen.getByRole( 'button', { name: /Default site directory/ } ) );

		await waitFor( () =>
			expect( mutate ).toHaveBeenCalledWith(
				{ defaultSiteDirectory: '/Users/example/Sites' },
				expect.any( Object )
			)
		);
		expect( selectDefaultSiteDirectory ).toHaveBeenCalledWith( '/Users/example/Studio' );
	} );
} );
