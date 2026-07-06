import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { useOffline } from '@/hooks/use-offline';
import { SettingsView, normalizeSettingsTab } from './index';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

vi.mock( '@wordpress/components', () => ( {
	FormToggle: ( props: {
		id?: string;
		checked: boolean;
		'aria-label'?: string;
		onChange: ( event: { target: { checked: boolean } } ) => void;
	} ) => (
		<input
			type="checkbox"
			id={ props.id }
			aria-label={ props[ 'aria-label' ] }
			checked={ props.checked }
			onChange={ ( event ) => props.onChange( { target: { checked: event.target.checked } } ) }
		/>
	),
} ) );

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
	Icon: () => <span aria-hidden="true" />,
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
	InputControl: ( {
		label,
		hideLabelFromVision,
		suffix,
		className,
		...props
	}: InputHTMLAttributes< HTMLInputElement > & {
		label: string;
		hideLabelFromVision?: boolean;
		suffix?: ReactNode;
	} ) => (
		<label className={ className }>
			{ ! hideLabelFromVision && <span>{ label }</span> }
			<input aria-label={ hideLabelFromVision ? label : undefined } { ...props } />
			{ suffix }
		</label>
	),
	InputLayout: {
		Slot: ( { children }: { children: ReactNode } ) => <span>{ children }</span>,
	},
	SelectControl: ( {
		items = [],
		label,
		value,
		onValueChange,
	}: {
		items?: Array< { label: string; value: string | null } >;
		label: string;
		value?: { label: string; value: string | null };
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
		Root: ( { children }: { children: ReactNode } ) => <>{ children }</>,
		Trigger: ( { render }: { render: ReactNode } ) => <>{ render }</>,
		Popup: ( { children }: { children: ReactNode } ) => <div role="tooltip">{ children }</div>,
		Positioner: () => null,
	},
} ) );

vi.mock( '@/components/wporg-login-dialog', () => ( {
	WporgLoginDialog: () => null,
} ) );

vi.mock( '@/components/gravatar', () => ( {
	Gravatar: ( { className }: { className?: string } ) => (
		<span className={ className } data-testid="gravatar" />
	),
} ) );

vi.mock( '@/components/learn-more', () => ( {
	LearnMoreLink: () => <a>Learn more</a>,
} ) );

vi.mock( '@/components/menu', () => ( {
	Root: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
	Trigger: ( { render }: { render: ReactNode } ) => <>{ render }</>,
	Popup: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
	Item: ( {
		children,
		disabled,
		onClick,
	}: {
		children: ReactNode;
		disabled?: boolean;
		onClick?: () => void;
	} ) => (
		<button type="button" disabled={ disabled } onClick={ onClick }>
			{ children }
		</button>
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

vi.mock( '@/data/queries/use-app-globals', () => ( {
	useAppGlobals: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: vi.fn(),
	useLogin: vi.fn(),
	useLogout: vi.fn(),
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

vi.mock( '@/hooks/use-fullscreen', () => ( {
	useFullscreen: () => false,
} ) );

vi.mock( '@/hooks/use-offline', () => ( {
	useOffline: vi.fn(),
} ) );

vi.mock( '@/hooks/use-prefers-color-scheme', () => ( {
	usePrefersColorScheme: () => 'light',
} ) );

vi.mock( '@/hooks/use-sidebar-collapsed', () => ( {
	useSidebarCollapsed: () => false,
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useAppGlobalsMock = vi.mocked( useAppGlobals );
const useAuthUserMock = vi.mocked( useAuthUser );
const useInstalledAppsMock = vi.mocked( useInstalledApps );
const useLoginMock = vi.mocked( useLogin );
const useLogoutMock = vi.mocked( useLogout );
const useDeleteAllSnapshotsMock = vi.mocked( useDeleteAllSnapshots );
const useSnapshotUsageMock = vi.mocked( useSnapshotUsage );
const useSnapshotsMock = vi.mocked( useSnapshots );
const useSaveUserPreferencesMock = vi.mocked( useSaveUserPreferences );
const useUserPreferencesMock = vi.mocked( useUserPreferences );
const useInstallWordPressSkillMock = vi.mocked( useInstallWordPressSkill );
const useRemoveWordPressSkillMock = vi.mocked( useRemoveWordPressSkill );
const useWordPressSkillsMock = vi.mocked( useWordPressSkills );
const useOfflineMock = vi.mocked( useOffline );

describe( 'SettingsView', () => {
	const mutate = vi.fn();
	const loginMutate = vi.fn();
	const logoutMutate = vi.fn();
	const deleteSnapshotsMutate = vi.fn();
	const installSkillMutate = vi.fn();
	const installSkillMutateAsync = vi.fn();
	const removeSkillMutate = vi.fn();
	const selectDefaultSiteDirectory = vi.fn();
	const confirmDeleteAllPreviewSites = vi.fn();
	const copyText = vi.fn();
	const openExternalUrl = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();

		selectDefaultSiteDirectory.mockResolvedValue( '/Users/example/Sites' );
		confirmDeleteAllPreviewSites.mockResolvedValue( true );
		copyText.mockResolvedValue( undefined );
		installSkillMutateAsync.mockResolvedValue( undefined );

		useConnectorMock.mockReturnValue( {
			previewColorScheme: vi.fn(),
			selectDefaultSiteDirectory,
			confirmDeleteAllPreviewSites,
			copyText,
			openExternalUrl,
			supportsAgenticOptOut: true,
		} as never );
		useAppGlobalsMock.mockReturnValue( {
			data: { isWindowsStore: false, platform: 'darwin' },
		} as never );
		useOfflineMock.mockReturnValue( false );
		useAuthUserMock.mockReturnValue( {
			data: {
				id: 1,
				displayName: 'Ada Lovelace',
				email: 'ada@example.com',
			},
			isLoading: false,
		} as never );
		useLoginMock.mockReturnValue( { mutate: loginMutate, isPending: false } as never );
		useLogoutMock.mockReturnValue( { mutate: logoutMutate, isPending: false } as never );
		useInstalledAppsMock.mockReturnValue( { data: {} } as never );
		useSaveUserPreferencesMock.mockReturnValue( {
			mutate,
			isPending: false,
		} as never );
		useUserPreferencesMock.mockReturnValue( {
			data: {
				editor: null,
				terminal: 'terminal',
				colorScheme: 'system',
				locale: 'en',
				defaultSiteDirectory: '/Users/example/Studio',
				studioCliInstalled: false,
				agenticFeaturesEnabled: true,
			},
			isLoading: false,
		} as never );
		useSnapshotsMock.mockReturnValue( { data: [], isLoading: false } as never );
		useSnapshotUsageMock.mockReturnValue( {
			data: { siteCount: 2, siteLimit: 10, siteCreationBlocked: false },
			isLoading: false,
		} as never );
		useDeleteAllSnapshotsMock.mockReturnValue( {
			mutate: deleteSnapshotsMutate,
			isPending: false,
			error: null,
		} as never );
		useWordPressSkillsMock.mockReturnValue( {
			data: [
				{
					id: 'studio-cli',
					displayName: 'Studio CLI',
					description: 'Use Studio from the terminal.',
					installed: true,
				},
				{
					id: 'wp-rest-api',
					displayName: 'WP REST API',
					description: 'Work with the WordPress REST API.',
					installed: false,
				},
			],
			isLoading: false,
			error: null,
		} as never );
		useInstallWordPressSkillMock.mockReturnValue( {
			mutate: installSkillMutate,
			mutateAsync: installSkillMutateAsync,
			isPending: false,
			error: null,
			variables: undefined,
		} as never );
		useRemoveWordPressSkillMock.mockReturnValue( {
			mutate: removeSkillMutate,
			isPending: false,
			error: null,
			variables: undefined,
		} as never );
	} );

	it( 'saves each preference change instantly, without a Save button', async () => {
		render( <SettingsView activeTab="preferences" onTabChange={ vi.fn() } /> );

		expect( screen.queryByRole( 'button', { name: 'Save' } ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByLabelText( 'Studio CLI for terminal' ) );

		expect( mutate ).toHaveBeenCalledWith( { studioCliInstalled: true }, expect.any( Object ) );

		fireEvent.click( screen.getByRole( 'textbox', { name: 'Default site directory' } ) );

		await waitFor( () =>
			expect( mutate ).toHaveBeenCalledWith(
				{ defaultSiteDirectory: '/Users/example/Sites' },
				expect.any( Object )
			)
		);
	} );

	it( 'saves the agentic features toggle on change', () => {
		render( <SettingsView activeTab="preferences" onTabChange={ vi.fn() } /> );

		fireEvent.click( screen.getByLabelText( 'Agentic features' ) );

		expect( mutate ).toHaveBeenCalledWith(
			{ agenticFeaturesEnabled: false },
			expect.any( Object )
		);
	} );

	it( 'hides the agentic features toggle for signed-out users', () => {
		useAuthUserMock.mockReturnValue( { data: null, isLoading: false } as never );

		render( <SettingsView activeTab="preferences" onTabChange={ vi.fn() } /> );

		expect( screen.queryByLabelText( 'Agentic features' ) ).not.toBeInTheDocument();
	} );

	it( 'renders usage and confirms preview-site deletion through the connector', async () => {
		const windowConfirmSpy = vi.spyOn( window, 'confirm' );

		render( <SettingsView activeTab="usage" onTabChange={ vi.fn() } /> );

		expect( screen.getByRole( 'heading', { name: 'Usage' } ) ).toBeInTheDocument();
		expect( screen.getByText( 'AI credits' ) ).toBeInTheDocument();
		expect(
			screen.getByText(
				'AI credits are free and unlimited while Studio Code is in beta. Build, iterate, and experiment without watching a meter.'
			)
		).toBeInTheDocument();
		expect( screen.getByText( 'Unlimited in beta' ) ).toBeInTheDocument();
		expect( screen.getByText( '2 of 10 active preview sites' ) ).toBeInTheDocument();
		expect( useSnapshotsMock ).toHaveBeenCalledWith( 1 );
		expect( useSnapshotUsageMock ).toHaveBeenCalledWith( 1 );
		expect( useDeleteAllSnapshotsMock ).toHaveBeenCalledWith( 1 );

		fireEvent.click( screen.getByRole( 'button', { name: 'Delete all preview sites' } ) );

		await waitFor( () => expect( confirmDeleteAllPreviewSites ).toHaveBeenCalledTimes( 1 ) );
		expect( deleteSnapshotsMutate ).toHaveBeenCalledTimes( 1 );
		expect( windowConfirmSpy ).not.toHaveBeenCalled();
		windowConfirmSpy.mockRestore();
	} );

	it( 'disables preview-site deletion while offline', () => {
		useOfflineMock.mockReturnValue( true );

		render( <SettingsView activeTab="usage" onTabChange={ vi.fn() } /> );

		const deleteAction = screen.getByRole( 'button', {
			name: 'Deleting preview sites requires an internet connection.',
		} );

		expect( deleteAction ).toBeDisabled();
		fireEvent.click( deleteAction );

		expect( confirmDeleteAllPreviewSites ).not.toHaveBeenCalled();
		expect( deleteSnapshotsMutate ).not.toHaveBeenCalled();
	} );

	it( 'hides native-only preferences in browser-hosted mode', () => {
		useAppGlobalsMock.mockReturnValue( {
			data: { isWindowsStore: false, platform: 'browser' },
		} as never );

		render( <SettingsView activeTab="preferences" onTabChange={ vi.fn() } /> );

		expect( screen.queryByText( 'Preferred editor' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Preferred terminal' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'textbox', { name: 'Default site directory' } )
		).not.toBeInTheDocument();
		expect( screen.queryByLabelText( 'Studio CLI for terminal' ) ).not.toBeInTheDocument();
	} );

	it( 'renders keyboard shortcuts', () => {
		render( <SettingsView activeTab="keyboard" onTabChange={ vi.fn() } /> );

		expect( screen.getByRole( 'button', { name: 'Keyboard' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'heading', { name: 'Keyboard shortcuts' } ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Use these keyboard shortcuts to move faster around Studio.' )
		).toBeInTheDocument();
		expect( screen.getByText( 'Add site' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Toggle sidebar' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Send message' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Insert newline' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Toggle site preview' ) ).toBeInTheDocument();
		// Sending is plain Return — the composer reserves modifier+Return for
		// inserting a newline.
		expect( screen.getByLabelText( 'Return' ) ).toBeInTheDocument();
		expect( normalizeSettingsTab( 'keyboard' ) ).toBe( 'keyboard' );
	} );

	it( 'renders the AI settings on the AI tab', () => {
		render( <SettingsView activeTab="ai" onTabChange={ vi.fn() } /> );

		expect( screen.getByRole( 'button', { name: 'AI' } ) ).toBeInTheDocument();
		expect( screen.getByLabelText( 'Agentic features' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'heading', { name: 'Default model' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'heading', { name: 'Response length' } ) ).toBeInTheDocument();
		expect( screen.getByLabelText( 'Chat notifications' ) ).toBeInTheDocument();
		expect( normalizeSettingsTab( 'ai' ) ).toBe( 'ai' );
	} );

	it( 'opens account help actions through buttons from preferences', () => {
		render( <SettingsView activeTab="preferences" onTabChange={ vi.fn() } /> );

		expect( screen.getByText( 'Ada Lovelace' ) ).toBeInTheDocument();
		expect( screen.getByText( 'ada@example.com' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'heading', { name: 'Account' } ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Edit WordPress.com profile' ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Docs' } ) );

		expect( openExternalUrl ).toHaveBeenCalledWith(
			'https://developer.wordpress.com/docs/developer-tools/studio/'
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Report an issue' } ) );

		expect( openExternalUrl ).toHaveBeenCalledWith(
			'https://github.com/Automattic/studio/issues/new/choose'
		);
	} );

	it( 'lets signed-out users log in from preferences', () => {
		useAuthUserMock.mockReturnValue( { data: null, isLoading: false } as never );

		render( <SettingsView activeTab="preferences" onTabChange={ vi.fn() } /> );

		fireEvent.click( screen.getAllByRole( 'button', { name: 'Log in' } )[ 0 ] );

		expect( loginMutate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'manages global WordPress skills', async () => {
		render( <SettingsView activeTab="skills" onTabChange={ vi.fn() } /> );

		expect( screen.getByRole( 'heading', { name: 'Skills' } ) ).toBeInTheDocument();
		expect(
			screen.getByText(
				/Skills are reusable instructions that teach agents how to complete specialized WordPress tasks/
			)
		).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Install' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Remove' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Install all' } ) );

		expect( installSkillMutate ).toHaveBeenCalledWith( 'wp-rest-api' );
		expect( removeSkillMutate ).toHaveBeenCalledWith( 'studio-cli' );
		await waitFor( () => expect( installSkillMutateAsync ).toHaveBeenCalledWith( 'wp-rest-api' ) );
	} );

	it( 'copies the MCP configuration through the connector', async () => {
		render( <SettingsView activeTab="mcp" onTabChange={ vi.fn() } /> );

		expect( screen.getByRole( 'heading', { name: 'MCP' } ) ).toBeInTheDocument();
		expect( screen.getByText( /MCP lets other AI tools talk to Studio/ ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Copy MCP configuration' } ) );

		await waitFor( () => expect( copyText ).toHaveBeenCalledTimes( 1 ) );
		expect( copyText.mock.calls[ 0 ][ 0 ] ).toContain( 'wordpress-studio' );
		await waitFor( () => expect( screen.getAllByText( 'Copied' ).length ).toBeGreaterThan( 0 ) );
	} );
} );
