import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { persister } from '@/data/core/query-client';
import { useInstalledApps } from '@/data/queries/use-installed-apps';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { SettingsView } from './index';
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
} ) );

vi.mock( '@/components/tabs', () => ( {
	Root: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
	List: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
	Tab: ( { children }: { children: ReactNode } ) => <button type="button">{ children }</button>,
	Panel: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
} ) );

vi.mock( '@/components/gravatar', () => ( {
	Gravatar: () => <span data-testid="gravatar" />,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
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

vi.mock( '@/hooks/use-sidebar-collapsed', () => ( {
	useSidebarCollapsed: () => false,
} ) );

vi.mock( '@/hooks/use-traffic-light-space', () => ( {
	useTrafficLightSpace: () => false,
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useInstalledAppsMock = vi.mocked( useInstalledApps );
const useSaveUserPreferencesMock = vi.mocked( useSaveUserPreferences );
const useUserPreferencesMock = vi.mocked( useUserPreferences );
const removeClientMock = vi.mocked( persister.removeClient );

describe( 'SettingsView', () => {
	const mutate = vi.fn();
	const reload = vi.fn();
	const disableAgenticUi = vi.fn( () => Promise.resolve() );

	beforeEach( () => {
		vi.clearAllMocks();

		Object.defineProperty( window, 'location', {
			value: { reload },
			writable: true,
			configurable: true,
		} );

		useConnectorMock.mockReturnValue( { disableAgenticUi } as never );
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
			},
			isLoading: false,
		} as never );
	} );

	it( 'saves the color scheme as soon as an appearance option is picked', () => {
		render( <SettingsView activeTab="preferences" onTabChange={ vi.fn() } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Dark' } ) );

		expect( mutate ).toHaveBeenCalledWith( { colorScheme: 'dark' }, expect.any( Object ) );
		expect( screen.queryByRole( 'button', { name: /save/i } ) ).not.toBeInTheDocument();
	} );

	it( 'saves the editor on change and only offers installed apps', () => {
		render( <SettingsView activeTab="preferences" onTabChange={ vi.fn() } /> );

		const editorSelect = screen.getByLabelText( 'Preferred editor' ) as HTMLSelectElement;
		expect( Array.from( editorSelect.options ).map( ( option ) => option.value ) ).toEqual( [
			'vscode',
		] );

		fireEvent.change( editorSelect, { target: { value: 'vscode' } } );

		expect( mutate ).toHaveBeenCalledWith( { editor: 'vscode' }, expect.any( Object ) );
	} );

	it( 'clears the persisted cache and reloads after a locale change is saved', async () => {
		mutate.mockImplementation( ( patch, options ) => options?.onSuccess?.() );

		render( <SettingsView activeTab="preferences" onTabChange={ vi.fn() } /> );

		fireEvent.change( screen.getByLabelText( 'Language' ), { target: { value: 'es' } } );

		expect( mutate ).toHaveBeenCalledWith( { locale: 'es' }, expect.any( Object ) );
		await waitFor( () => expect( reload ).toHaveBeenCalled() );
		expect( removeClientMock ).toHaveBeenCalled();
	} );

	it( 'saves the quit-sites behavior on change', () => {
		render( <SettingsView activeTab="preferences" onTabChange={ vi.fn() } /> );

		fireEvent.change( screen.getByLabelText( 'When quitting with running sites' ), {
			target: { value: 'stop' },
		} );

		expect( mutate ).toHaveBeenCalledWith( { quitSitesBehavior: 'stop' }, expect.any( Object ) );
	} );

	it( 'switches back to the classic UI through the connector', () => {
		render( <SettingsView activeTab="preferences" onTabChange={ vi.fn() } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Switch to classic' } ) );

		expect( disableAgenticUi ).toHaveBeenCalled();
		expect( mutate ).not.toHaveBeenCalled();
	} );

	it( 'surfaces a save error inline in the section', () => {
		useSaveUserPreferencesMock.mockReturnValue( {
			mutate,
			isPending: false,
			isError: true,
			error: new Error( 'save failed' ),
		} as never );

		render( <SettingsView activeTab="preferences" onTabChange={ vi.fn() } /> );

		expect(
			screen.getByText( 'An error occurred while saving settings. Please try again.' )
		).toBeInTheDocument();
	} );
} );
