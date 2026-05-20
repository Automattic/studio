import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { SiteContentTabs } from 'src/components/site-content-tabs';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { WorkspaceSelectionProvider } from 'src/modules/workspaces';
import { store } from 'src/stores';
import { syncOperationsActions } from 'src/stores/sync';
import { testActions, testReducer } from 'src/stores/tests/utils/test-reducer';
import type { SyncSite } from '@studio/common/types/sync';
import type { WorkspacePreviewState } from 'src/modules/workspaces/components/workspace-preview';
import type { WorkspaceTargetId } from 'src/modules/workspaces/types';

const featureFlagsMock = vi.hoisted( () => ( {
	enableBlueprints: true,
	enableStudioCodeUi: false,
	enableWorkspaces: false,
} ) );
const useGetWpComSitesQueryMock = vi.hoisted( () => vi.fn() );
const useGetActiveWpcomThemeQueryMock = vi.hoisted( () => vi.fn() );
const useGetWpcomSiteSettingsQueryMock = vi.hoisted( () => vi.fn() );
const syncHooksMock = vi.hoisted( () => ( {
	useLatestRewindId: vi.fn(),
	useRemoteFileTree: vi.fn(),
} ) );

const selectedSite: SiteDetails = {
	id: 'site-id-1',
	name: 'Test Site',
	running: false,
	path: '/test-site',
	port: 8881,
	phpVersion: '8.4',
};

vi.mock( 'src/hooks/use-site-details' );
vi.mock( 'src/components/content-tab-assistant', () => ( {
	ContentTabAssistant: ( { selectedSite }: { selectedSite: SiteDetails } ) => (
		<div data-testid="local-content-tab-assistant">{ selectedSite.name }</div>
	),
} ) );
vi.mock( 'src/modules/workspaces/components/workspace-dolly-assistant', () => ( {
	WorkspaceDollyAssistant: ( {
		onOpenPreviewTarget,
		previewState,
	}: {
		onOpenPreviewTarget: (
			targetId: WorkspaceTargetId,
			pathOrUrl: string,
			nextPreviewState: WorkspacePreviewState
		) => void;
		previewState: WorkspacePreviewState;
	} ) => (
		<div data-testid="workspace-dolly-assistant">
			<button
				type="button"
				onClick={ () =>
					onOpenPreviewTarget( 'staging', 'https://staging.example/wp-admin/', {
						...previewState,
						open: true,
						pathOrUrl: 'https://staging.example/wp-admin/',
						currentUrl: 'https://staging.example/wp-admin/',
						canGoBack: true,
					} )
				}
			>
				Mock open staging preview
			</button>
		</div>
	),
} ) );
vi.mock( 'src/hooks/use-feature-flags', () => ( {
	useFeatureFlags: () => featureFlagsMock,
} ) );
vi.mock( 'src/hooks/use-auth', () => ( {
	useAuth: () => ( {
		isAuthenticated: true,
		authenticate: vi.fn(),
		user: { id: 123, email: 'user@example.com', displayName: 'User' },
		client: {} as never,
	} ),
} ) );
vi.mock( 'src/lib/app-globals', async () => ( {
	...( await vi.importActual( '../../lib/app-globals' ) ),
	getAppGlobals: vi.fn().mockReturnValue( { locale: ' en' } ),
	isWindows: vi.fn().mockReturnValue( false ),
} ) );
vi.mock( 'src/lib/get-ipc-api', async () => ( {
	...( await vi.importActual( '../../lib/get-ipc-api' ) ),
	getIpcApi: vi.fn().mockReturnValue( {
		getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
		updateConnectedWpcomSites: vi.fn(),
		getUserTerminal: vi.fn().mockResolvedValue( 'terminal' ),
		getUserEditor: vi.fn().mockResolvedValue( 'vscode' ),
		showErrorMessageBox: vi.fn(),
		showMessageBox: vi.fn().mockResolvedValue( { response: 0 } ),
		showNotification: vi.fn(),
		connectWpcomSites: vi.fn().mockResolvedValue( undefined ),
		openSiteURL: vi.fn(),
		openURL: vi.fn(),
		setWindowControlVisibility: vi.fn(),
	} ),
} ) );

vi.mock( 'src/stores/wordpress-versions-api', async () => {
	const actual = await vi.importActual( 'src/stores/wordpress-versions-api' );
	return {
		...actual,
		useGetWordPressVersions: vi.fn( () => ( {
			sites: [
				{ label: 'Latest', value: 'latest', isBeta: false, isDevelopment: false },
				{ label: '6.4', value: '6.4', isBeta: false, isDevelopment: false },
				{ label: '6.3', value: '6.3', isBeta: false, isDevelopment: false },
			],
			isLoading: false,
		} ) ),
	};
} );

vi.mock( 'src/stores/wpcom-api', async () => {
	const actual = await vi.importActual( 'src/stores/wpcom-api' );
	return {
		...actual,
		useGetBlueprints: vi.fn( () => ( {
			sites: { blueprints: [], total: 0 },
			isLoading: false,
		} ) ),
	};
} );

vi.mock( 'src/stores/sync/wpcom-sites', async () => {
	const actual = await vi.importActual< typeof import('src/stores/sync/wpcom-sites') >(
		'src/stores/sync/wpcom-sites'
	);
	return {
		...actual,
		useGetWpComSitesQuery: useGetWpComSitesQueryMock,
		useGetActiveWpcomThemeQuery: useGetActiveWpcomThemeQueryMock,
		useGetWpcomSiteSettingsQuery: useGetWpcomSiteSettingsQueryMock,
	};
} );
vi.mock( 'src/stores/sync/sync-hooks', async () => {
	const actual = await vi.importActual< typeof import('src/stores/sync/sync-hooks') >(
		'src/stores/sync/sync-hooks'
	);
	return {
		...actual,
		useLatestRewindId: syncHooksMock.useLatestRewindId,
		useRemoteFileTree: syncHooksMock.useRemoteFileTree,
	};
} );

store.replaceReducer( testReducer );

const createSyncSite = ( overrides: Partial< SyncSite > = {} ): SyncSite => ( {
	id: 101,
	localSiteId: '',
	name: 'Remote Site',
	url: 'https://remote.example',
	isStaging: false,
	isPressable: false,
	syncSupport: 'syncable',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
	...overrides,
} );

const createSiteDetailsReturn = ( {
	selectedSite: selectedSiteValue = selectedSite,
	sites = [ selectedSite ],
	setSelectedSiteId = vi.fn(),
	startServer = vi.fn(),
}: {
	selectedSite?: SiteDetails | null;
	sites?: SiteDetails[];
	setSelectedSiteId?: ReturnType< typeof vi.fn >;
	startServer?: ReturnType< typeof vi.fn >;
} = {} ) =>
	( {
		selectedSite: selectedSiteValue,
		sites,
		loadingServer: {},
		siteCreationMessages: {},
		setSelectedSiteId,
		startServer,
		stopServer: vi.fn(),
	} ) as Partial< ReturnType< typeof useSiteDetails > >;

const mockWpcomSitesQuery = ( sites: SyncSite[] = [] ) => {
	useGetWpComSitesQueryMock.mockReturnValue( {
		data: { sites, total: sites.length, page: 1, perPage: 100 },
		isLoading: false,
		isFetching: false,
		refetch: vi.fn(),
	} );
};

const mockActiveWpcomThemeQuery = (
	data:
		| {
				id?: string;
				name?: string;
				screenshotUrl?: string;
				isBlockTheme?: boolean;
		  }
		| undefined = undefined
) => {
	useGetActiveWpcomThemeQueryMock.mockReturnValue( {
		data,
		isLoading: false,
		isFetching: false,
		refetch: vi.fn(),
	} );
};

const mockWpcomSiteSettingsQuery = (
	data:
		| {
				id?: number;
				name?: string;
				description?: string;
				url?: string;
				lang?: string;
				localeVariant?: string;
				settings: Record< string, unknown >;
		  }
		| undefined = undefined
) => {
	useGetWpcomSiteSettingsQueryMock.mockReturnValue( {
		data,
		isLoading: false,
		isFetching: false,
		refetch: vi.fn(),
	} );
};

describe( 'SiteContentTabs', () => {
	beforeEach( () => {
		vi.clearAllMocks(); // Clear mock call history between tests
		localStorage.clear();
		featureFlagsMock.enableWorkspaces = false;
		mockWpcomSitesQuery();
		mockActiveWpcomThemeQuery();
		mockWpcomSiteSettingsQuery();
		syncHooksMock.useLatestRewindId.mockReturnValue( {
			rewindId: null,
			isLoading: false,
			isError: false,
		} );
		syncHooksMock.useRemoteFileTree.mockReturnValue( {
			fetchChildren: vi.fn().mockResolvedValue( [] ),
			isLoading: false,
			error: null,
		} );
		store.dispatch( testActions.resetState() );
	} );
	const renderWithProvider = ( component: React.ReactElement ) => {
		return render(
			<Provider store={ store }>
				<ContentTabsProvider>
					<WorkspaceSelectionProvider>{ component }</WorkspaceSelectionProvider>
				</ContentTabsProvider>
			</Provider>
		);
	};
	it( 'should render tabs correctly if selected site exists', async () => {
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn(),
		} );
		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		expect( screen.getByTestId( 'site-content-header' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'tab', { name: 'Settings' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'tab', { name: 'Sync' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'tab', { name: 'Previews' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'tab', { name: 'Import / Export' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'tab', { name: 'Launchpad' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'tab', { name: 'Publish' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'tab', { name: 'Export' } ) ).not.toBeInTheDocument();
	} );
	it( 'selects the Overview tab by default', async () => {
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn(),
		} );
		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		expect( screen.queryByRole( 'tab', { name: 'Overview', selected: true } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Sync', selected: false } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Previews', selected: false } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Settings', selected: false } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Assistant', selected: false } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'tab', { name: 'Backup', selected: false } )
		).not.toBeInTheDocument();
	} );

	it( 'renders the shared workspace shell for a local target when enabled', async () => {
		featureFlagsMock.enableWorkspaces = true;
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn(),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );

		expect( screen.getByTestId( 'workspace-content-header' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'tab', { name: 'Overview' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Previews' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Import / Export' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Assistant' } ) ).toBeVisible();
		expect(
			screen
				.getByTestId( 'workspace-content-body' )
				.querySelector( '.workspace-content-shell__tabs--preview-controls-closed' )
		).toHaveStyle( '--workspace-preview-controls-width: 520px' );
		expect(
			within( screen.getByTestId( 'workspace-preview-controls' ) ).getByRole( 'button', {
				name: 'Show preview',
			} )
		).toBeVisible();
		expect(
			within( screen.getByTestId( 'workspace-content-body' ) ).queryByLabelText(
				'Workspace site preview'
			)
		).not.toBeInTheDocument();
	} );

	it( 'keeps local preview closed by default without starting the local site', async () => {
		const startServer = vi.fn( () => Promise.resolve() );
		featureFlagsMock.enableWorkspaces = true;
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn( { startServer } ),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );

		expect( startServer ).not.toHaveBeenCalled();
		expect(
			within( screen.getByTestId( 'workspace-content-body' ) ).queryByLabelText(
				'Workspace site preview'
			)
		).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Show preview' } ) ).toBeVisible();
	} );

	it( 'keeps the local workspace Assistant tab on the existing local assistant', async () => {
		const user = userEvent.setup();
		featureFlagsMock.enableWorkspaces = true;
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn(),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		await user.click( screen.getByRole( 'tab', { name: 'Assistant' } ) );

		expect( screen.getByTestId( 'local-content-tab-assistant' ) ).toHaveTextContent( 'Test Site' );
		expect( screen.queryByTestId( 'workspace-dolly-assistant' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps linked workspace tabs stable and scopes content to the selected target', async () => {
		const user = userEvent.setup();
		featureFlagsMock.enableWorkspaces = true;
		mockWpcomSitesQuery( [
			createSyncSite( {
				id: 101,
				localSiteId: selectedSite.id,
				name: 'Linked Workspace',
				url: 'https://linked.example',
			} ),
		] );
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn( {
				selectedSite,
				sites: [ selectedSite ],
			} ),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );

		expect( screen.getByRole( 'tab', { name: 'Overview', selected: true } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Previews' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Import / Export' } ) ).toBeVisible();

		await user.click(
			within( screen.getByTestId( 'workspace-content-header' ) ).getByRole( 'button', {
				name: 'Workspace target',
			} )
		);
		await user.click( screen.getByRole( 'option', { name: 'Production' } ) );

		expect( screen.getByRole( 'tab', { name: 'Overview', selected: true } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Previews' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Import / Export' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Sync' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Settings' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Site Editor' } ) ).toBeVisible();
		expect(
			screen.queryByText( 'This section is managed in the Local target.' )
		).not.toBeInTheDocument();

		await user.click( screen.getByRole( 'tab', { name: 'Assistant' } ) );

		expect( screen.getByTestId( 'workspace-dolly-assistant' ) ).toBeInTheDocument();
		expect( screen.queryByTestId( 'local-content-tab-assistant' ) ).not.toBeInTheDocument();

		await user.click(
			within( screen.getByTestId( 'workspace-content-header' ) ).getByRole( 'button', {
				name: 'Workspace target',
			} )
		);
		await user.click( screen.getByRole( 'option', { name: 'Local' } ) );

		expect( screen.getByRole( 'tab', { name: 'Assistant', selected: true } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Overview' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Previews' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Import / Export' } ) ).toBeVisible();
		expect( screen.getByTestId( 'local-content-tab-assistant' ) ).toHaveTextContent( 'Test Site' );
		expect( screen.queryByTestId( 'workspace-dolly-assistant' ) ).not.toBeInTheDocument();
	} );

	it( 'renders remote Production targets with the shared workspace tabs', async () => {
		const user = userEvent.setup();
		featureFlagsMock.enableWorkspaces = true;
		mockActiveWpcomThemeQuery( { name: 'Remote Theme', isBlockTheme: true } );
		mockWpcomSitesQuery( [ createSyncSite( { id: 101, name: 'Remote Only' } ) ] );
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn( { selectedSite: null, sites: [] } ),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );

		expect( screen.getByTestId( 'workspace-content-header' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'tab', { name: 'Overview', selected: true } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Assistant' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Assistant' } ) ).toHaveClass(
			'components-tab-panel__tabs--assistant'
		);
		expect( screen.getByRole( 'tab', { name: 'Assistant' } ) ).toHaveClass( 'ltr:ml-auto' );
		expect( screen.getByRole( 'tab', { name: 'Sync' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Previews' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Import / Export' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Settings' } ) ).toBeVisible();
		expect( screen.getByText( 'Remote Theme' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Site Editor' } ) ).toBeVisible();
		expect( screen.queryByText( 'Open in…' ) ).not.toBeInTheDocument();

		await user.click( screen.getByRole( 'button', { name: 'Site Editor' } ) );

		expect( getIpcApi().openURL ).toHaveBeenLastCalledWith(
			'https://remote.example/wp-admin/site-editor.php'
		);
		expect(
			within( screen.getByTestId( 'workspace-content-body' ) ).queryByLabelText(
				'Workspace site preview'
			)
		).not.toBeInTheDocument();
		expect(
			within( screen.getByTestId( 'workspace-preview-controls' ) ).getByRole( 'button', {
				name: 'Show preview',
			} )
		).toBeVisible();
	} );

	it( 'renders live site settings for the selected remote target', async () => {
		const user = userEvent.setup();
		featureFlagsMock.enableWorkspaces = true;
		mockWpcomSitesQuery( [
			createSyncSite( {
				id: 101,
				name: 'Remote Only',
				url: 'https://remote.example',
				planName: 'Business',
				wpVersion: '6.8',
				canManageOptions: true,
			} ),
		] );
		mockWpcomSiteSettingsQuery( {
			id: 101,
			name: 'Live Site Title',
			description: 'Live site tagline',
			url: 'https://remote.example',
			lang: 'en',
			settings: {
				blog_public: 0,
				show_on_front: 'page',
				page_on_front: 42,
				timezone_string: 'America/New_York',
				jetpack_relatedposts_enabled: true,
			},
		} );
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn( { selectedSite: null, sites: [] } ),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		await user.click( screen.getByRole( 'tab', { name: 'Settings' } ) );

		expect( screen.getByText( 'Live Site Title' ) ).toBeVisible();
		expect( screen.getByText( 'Live site tagline' ) ).toBeVisible();
		expect( screen.getByText( 'Discourage search engines' ) ).toBeVisible();
		expect( screen.getByText( 'Static page, page ID 42' ) ).toBeVisible();
		expect( screen.getByText( 'Business' ) ).toBeVisible();

		await user.click( screen.getByRole( 'button', { name: 'Reading' } ) );

		expect( getIpcApi().openURL ).toHaveBeenLastCalledWith(
			'https://remote.example/wp-admin/options-reading.php'
		);
	} );

	it( 'opens remote preview under the workspace header', async () => {
		const user = userEvent.setup();
		featureFlagsMock.enableWorkspaces = true;
		mockWpcomSitesQuery( [ createSyncSite( { id: 101, name: 'Remote Only' } ) ] );
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn( { selectedSite: null, sites: [] } ),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		await user.click(
			within( screen.getByTestId( 'workspace-preview-controls' ) ).getByRole( 'button', {
				name: 'Show preview',
			} )
		);
		expect(
			screen
				.getByTestId( 'workspace-content-body' )
				.querySelector( '.workspace-content-shell__tabs--preview-controls-closed' )
		).not.toBeInTheDocument();

		expect(
			within( screen.getByTestId( 'workspace-preview-controls' ) ).getByRole( 'button', {
				name: 'Reload preview',
			} )
		).toBeVisible();
		expect(
			within( screen.getByTestId( 'workspace-preview-controls' ) ).getByRole( 'button', {
				name: 'Back',
			} )
		).toBeDisabled();
		expect(
			within( screen.getByTestId( 'workspace-preview-controls' ) ).getByRole( 'button', {
				name: 'Forward',
			} )
		).toBeDisabled();
		expect(
			within( screen.getByTestId( 'workspace-content-body' ) ).getByLabelText(
				'Workspace site preview'
			)
		).toBeVisible();
		const resizeHandle = within( screen.getByTestId( 'workspace-content-body' ) ).getByRole(
			'separator',
			{
				name: 'Resize preview',
			}
		);
		expect( resizeHandle ).toHaveAttribute( 'aria-valuenow', '520' );

		resizeHandle.focus();
		await user.keyboard( '{ArrowLeft}' );

		expect( resizeHandle ).toHaveAttribute( 'aria-valuenow', '552' );
	} );

	it( 'releases preview resizing even when dragging over the preview panel', async () => {
		const user = userEvent.setup();
		featureFlagsMock.enableWorkspaces = true;
		mockWpcomSitesQuery( [ createSyncSite( { id: 101, name: 'Remote Only' } ) ] );
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn( { selectedSite: null, sites: [] } ),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		await user.click(
			within( screen.getByTestId( 'workspace-preview-controls' ) ).getByRole( 'button', {
				name: 'Show preview',
			} )
		);

		const previewPanel = within( screen.getByTestId( 'workspace-content-body' ) ).getByLabelText(
			'Workspace site preview'
		);
		vi.spyOn( previewPanel, 'getBoundingClientRect' ).mockReturnValue( {
			x: 480,
			y: 0,
			width: 520,
			height: 500,
			top: 0,
			right: 1000,
			bottom: 500,
			left: 480,
			toJSON: () => ( {} ),
		} );
		const resizeHandle = within( screen.getByTestId( 'workspace-content-body' ) ).getByRole(
			'separator',
			{
				name: 'Resize preview',
			}
		);

		fireEvent.mouseDown( resizeHandle, { clientX: 480 } );

		const resizeOverlay = screen.getByTestId( 'workspace-preview-resize-overlay' );
		fireEvent.mouseMove( resizeOverlay, { clientX: 420 } );

		expect(
			within( screen.getByTestId( 'workspace-content-body' ) ).getByRole( 'separator', {
				name: 'Resize preview',
			} )
		).toHaveAttribute( 'aria-valuenow', '580' );

		fireEvent.mouseUp( resizeOverlay );

		expect( screen.queryByTestId( 'workspace-preview-resize-overlay' ) ).not.toBeInTheDocument();
	} );

	it( 'switches preview targets inside the workspace shell without changing tabs', async () => {
		const user = userEvent.setup();
		featureFlagsMock.enableWorkspaces = true;
		const productionSite = createSyncSite( {
			id: 101,
			name: 'Remote Workspace',
			url: 'https://production.example',
			stagingSiteIds: [ 202 ],
		} );
		const stagingSite = createSyncSite( {
			id: 202,
			name: 'Remote Workspace Staging',
			url: 'https://staging.example',
			isStaging: true,
			productionSiteId: 101,
		} );
		mockWpcomSitesQuery( [ productionSite, stagingSite ] );
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn( { selectedSite: null, sites: [] } ),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		await user.click(
			within( screen.getByTestId( 'workspace-preview-controls' ) ).getByRole( 'button', {
				name: 'Show preview',
			} )
		);
		const resizeHandle = within( screen.getByTestId( 'workspace-content-body' ) ).getByRole(
			'separator',
			{
				name: 'Resize preview',
			}
		);
		resizeHandle.focus();
		await user.keyboard( '{ArrowLeft}' );
		await user.click( screen.getByRole( 'tab', { name: 'Assistant' } ) );
		await user.click(
			within( screen.getByTestId( 'workspace-content-header' ) ).getByRole( 'button', {
				name: 'Workspace target',
			} )
		);
		await user.click( screen.getByRole( 'option', { name: 'Production' } ) );

		expect( screen.getByRole( 'tab', { name: 'Assistant', selected: true } ) ).toBeVisible();
		expect( screen.getByTitle( 'Remote Workspace preview' ) ).toHaveAttribute(
			'src',
			'https://production.example/'
		);
		expect( resizeHandle ).toHaveAttribute( 'aria-valuenow', '552' );
	} );

	it( 'rebases chat-updated preview URLs when switching targets', async () => {
		const user = userEvent.setup();
		featureFlagsMock.enableWorkspaces = true;
		const productionSite = createSyncSite( {
			id: 101,
			name: 'Remote Workspace',
			url: 'https://production.example',
			stagingSiteIds: [ 202 ],
		} );
		const stagingSite = createSyncSite( {
			id: 202,
			name: 'Remote Workspace Staging',
			url: 'https://staging.example',
			isStaging: true,
			productionSiteId: 101,
		} );
		mockWpcomSitesQuery( [ productionSite, stagingSite ] );
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn( { selectedSite: null, sites: [] } ),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		await user.click( screen.getByRole( 'tab', { name: 'Assistant' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Mock open staging preview' } ) );

		await waitFor( () =>
			expect( screen.getByTitle( 'Remote Workspace Staging preview' ) ).toHaveAttribute(
				'src',
				'https://staging.example/wp-admin/'
			)
		);

		await user.click(
			within( screen.getByTestId( 'workspace-content-header' ) ).getByRole( 'button', {
				name: 'Workspace target',
			} )
		);
		await user.click( screen.getByRole( 'option', { name: 'Production' } ) );

		await waitFor( () =>
			expect( screen.getByTitle( 'Remote Workspace preview' ) ).toHaveAttribute(
				'src',
				'https://production.example/wp-admin/'
			)
		);
	} );

	it( 'renders a visible header target picker backed by the preview target', async () => {
		const user = userEvent.setup();
		featureFlagsMock.enableWorkspaces = true;
		mockWpcomSitesQuery( [
			createSyncSite( {
				id: 101,
				localSiteId: selectedSite.id,
				name: 'Linked Workspace',
				url: 'https://linked.example',
			} ),
		] );
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn( {
				selectedSite,
				sites: [ selectedSite ],
			} ),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );

		const headerTargetPicker = within( screen.getByTestId( 'workspace-content-header' ) ).getByRole(
			'button',
			{ name: 'Workspace target' }
		);
		expect(
			screen.queryByRole( 'button', { name: /Select Local target:/ } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: /Select Production target:/ } )
		).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Preview target' } ) ).not.toBeInTheDocument();
		expect( headerTargetPicker ).toHaveTextContent( /Viewing\s*Local/ );
		expect(
			screen.queryByLabelText( 'Local target: Test Site is stopped' )
		).not.toBeInTheDocument();

		await user.click( headerTargetPicker );
		await user.click( screen.getByRole( 'option', { name: 'Production' } ) );

		expect( headerTargetPicker ).toHaveTextContent( /Viewing\s*Production/ );
		await user.click( screen.getByRole( 'button', { name: 'Show preview' } ) );
		expect( screen.getByTitle( 'Linked Workspace preview' ) ).toHaveAttribute(
			'src',
			'https://linked.example/'
		);
	} );

	it( 'updates workspace header links for the selected live target', async () => {
		const user = userEvent.setup();
		featureFlagsMock.enableWorkspaces = true;
		const productionSite = createSyncSite( {
			id: 101,
			name: 'Remote Workspace',
			url: 'https://production.example',
			stagingSiteIds: [ 202 ],
		} );
		const stagingSite = createSyncSite( {
			id: 202,
			name: 'Remote Workspace Staging',
			url: 'https://staging.example',
			isStaging: true,
			productionSiteId: 101,
		} );
		mockWpcomSitesQuery( [ productionSite, stagingSite ] );
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn( { selectedSite: null, sites: [] } ),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );

		const header = within( screen.getByTestId( 'workspace-content-header' ) );
		expect( header.getByRole( 'button', { name: /Staging WP admin/ } ) ).toBeVisible();
		expect( header.getByRole( 'button', { name: /Open staging site/ } ) ).toBeVisible();

		await user.click( header.getByRole( 'button', { name: /Open staging site/ } ) );

		expect( getIpcApi().openURL ).toHaveBeenLastCalledWith( 'https://staging.example/' );

		await user.click( header.getByRole( 'button', { name: 'Workspace target' } ) );
		await user.click( screen.getByRole( 'option', { name: 'Production' } ) );

		expect( header.getByRole( 'button', { name: /Production WP admin/ } ) ).toBeVisible();
		expect( header.getByRole( 'button', { name: /Open production site/ } ) ).toBeVisible();

		await user.click( header.getByRole( 'button', { name: /Production WP admin/ } ) );

		expect( getIpcApi().openURL ).toHaveBeenLastCalledWith(
			'https://production.example/wp-admin/'
		);
	} );

	it( 'shows the local Start button only when the Local preview target is selected', async () => {
		const user = userEvent.setup();
		const startServer = vi.fn( () => Promise.resolve() );
		featureFlagsMock.enableWorkspaces = true;
		mockWpcomSitesQuery( [
			createSyncSite( {
				id: 101,
				localSiteId: selectedSite.id,
				name: 'Linked Workspace',
				url: 'https://linked.example',
			} ),
		] );
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn( {
				selectedSite,
				sites: [ selectedSite ],
				startServer,
			} ),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );

		const startButton = within( screen.getByTestId( 'workspace-content-header' ) ).getByRole(
			'button',
			{
				name: 'Start',
			}
		);
		expect( startButton ).toBeVisible();

		await user.click( startButton );

		expect( startServer ).toHaveBeenCalledWith( selectedSite );

		await user.click(
			within( screen.getByTestId( 'workspace-content-header' ) ).getByRole( 'button', {
				name: 'Workspace target',
			} )
		);
		await user.click( screen.getByRole( 'option', { name: 'Production' } ) );

		expect(
			within( screen.getByTestId( 'workspace-content-header' ) ).queryByRole( 'button', {
				name: 'Start',
			} )
		).not.toBeInTheDocument();
	} );

	it( 'switches preview targets before opening the preview', async () => {
		const user = userEvent.setup();
		featureFlagsMock.enableWorkspaces = true;
		mockWpcomSitesQuery( [
			createSyncSite( {
				id: 101,
				localSiteId: selectedSite.id,
				name: 'Linked Workspace',
				url: 'https://linked.example',
			} ),
		] );
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn( {
				selectedSite,
				sites: [ selectedSite ],
			} ),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );

		expect( screen.queryByLabelText( 'Workspace site preview' ) ).not.toBeInTheDocument();

		await user.click(
			within( screen.getByTestId( 'workspace-content-header' ) ).getByRole( 'button', {
				name: 'Workspace target',
			} )
		);
		await user.click( screen.getByRole( 'option', { name: 'Production' } ) );

		expect( screen.queryByLabelText( 'Workspace site preview' ) ).not.toBeInTheDocument();

		await user.click( screen.getByRole( 'button', { name: 'Show preview' } ) );

		expect( screen.getByTitle( 'Linked Workspace preview' ) ).toHaveAttribute(
			'src',
			'https://linked.example/'
		);
	} );

	it( 'omits missing target buttons from the shell', async () => {
		featureFlagsMock.enableWorkspaces = true;
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn(),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );

		expect(
			screen.queryByRole( 'button', { name: 'Production target unavailable' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Staging target unavailable' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByLabelText( 'Local target: Test Site is stopped' )
		).not.toBeInTheDocument();
	} );

	it( 'renders workspace sync controls for local, production, and staging links', async () => {
		const user = userEvent.setup();
		featureFlagsMock.enableWorkspaces = true;
		const productionSite = createSyncSite( {
			id: 101,
			localSiteId: selectedSite.id,
			syncSupport: 'already-connected',
			name: 'Linked Workspace',
			url: 'https://production.example',
			stagingSiteIds: [ 202 ],
		} );
		const stagingSite = createSyncSite( {
			id: 202,
			localSiteId: selectedSite.id,
			syncSupport: 'already-connected',
			name: 'Linked Workspace Staging',
			url: 'https://staging.example',
			isStaging: true,
			productionSiteId: 101,
		} );
		mockWpcomSitesQuery( [ productionSite, stagingSite ] );
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn( {
				selectedSite,
				sites: [ selectedSite ],
			} ),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		await user.click( screen.getByRole( 'tab', { name: 'Sync' } ) );

		expect( screen.getByTestId( 'workspace-sync-panel' ) ).toBeVisible();
		expect( screen.getAllByText( 'Linked Workspace' ).length ).toBeGreaterThan( 0 );
		expect( screen.getByText( 'Linked Workspace Staging' ) ).toBeVisible();
		expect( screen.getByText( 'Production and staging' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Push to Staging' } ) ).toBeEnabled();
		expect( screen.getByRole( 'button', { name: 'Pull to Production' } ) ).toBeEnabled();

		await user.click( screen.getByRole( 'button', { name: 'Pull to Production' } ) );

		expect( screen.getByRole( 'heading', { name: 'Pull from Staging' } ) ).toBeVisible();
		expect( screen.getByRole( 'checkbox', { name: 'Files and folders' } ) ).not.toBeChecked();
		expect( screen.getByText( 'All files and folders' ) ).toBeVisible();
		expect( screen.getByRole( 'checkbox', { name: 'Database' } ) ).not.toBeChecked();
		expect( screen.queryByText( 'Root files' ) ).not.toBeInTheDocument();
		expect( screen.getByTestId( 'environment-sync-submit-button' ) ).toBeDisabled();

		await user.click( screen.getByRole( 'checkbox', { name: 'Files and folders' } ) );

		expect( screen.getByTestId( 'environment-sync-submit-button' ) ).toBeEnabled();
	} );

	it( 'offers setup actions for a remote-only production workspace', async () => {
		const user = userEvent.setup();
		featureFlagsMock.enableWorkspaces = true;
		const productionSite = createSyncSite( {
			id: 101,
			name: 'Remote Workspace',
			url: 'https://remote-workspace.example',
			hasStagingSiteFeature: true,
			canManageOptions: true,
		} );
		mockWpcomSitesQuery( [ productionSite ] );
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn( { selectedSite: null, sites: [] } ),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		await user.click( screen.getByRole( 'tab', { name: 'Sync' } ) );

		expect(
			screen.queryByText( 'No workspace sync links are available yet.' )
		).not.toBeInTheDocument();
		expect( screen.getAllByText( 'Remote Workspace' ).length ).toBeGreaterThan( 0 );
		expect( screen.getByRole( 'button', { name: 'Create local copy' } ) ).toBeVisible();
		expect( screen.getByText( 'Production and staging' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Create staging site' } ) ).toBeVisible();
	} );

	it( 'does not offer local copy setup when a remote site cannot support Studio sync', async () => {
		const user = userEvent.setup();
		featureFlagsMock.enableWorkspaces = true;
		const productionSite = createSyncSite( {
			id: 101,
			name: 'Remote Workspace',
			url: 'https://remote-workspace.example',
			syncSupport: 'needs-upgrade',
			hasStagingSiteFeature: true,
			canManageOptions: true,
			isWpcomAtomic: true,
		} );
		mockWpcomSitesQuery( [ productionSite ] );
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn( { selectedSite: null, sites: [] } ),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		await user.click( screen.getByRole( 'tab', { name: 'Sync' } ) );

		expect(
			screen.getByText( 'Upgrade this site plan before creating or connecting a local version.' )
		).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Create local copy' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: /Upgrade plan/ } ) ).toBeVisible();
	} );

	it( 'does not offer staging creation when production is not eligible for staging sites', async () => {
		const user = userEvent.setup();
		featureFlagsMock.enableWorkspaces = true;
		const productionSite = createSyncSite( {
			id: 101,
			name: 'Remote Workspace',
			url: 'https://remote-workspace.example',
			syncSupport: 'syncable',
			hasStagingSiteFeature: false,
			canManageOptions: true,
			isWpcomAtomic: true,
		} );
		mockWpcomSitesQuery( [ productionSite ] );
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn( { selectedSite: null, sites: [] } ),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		await user.click( screen.getByRole( 'tab', { name: 'Sync' } ) );

		expect( screen.getByText( 'This site plan does not include staging sites.' ) ).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'Create staging site' } )
		).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: /Upgrade plan/ } ) ).toBeVisible();
	} );

	it( 'offers to connect an unlinked production target when local and staging are connected', async () => {
		const user = userEvent.setup();
		featureFlagsMock.enableWorkspaces = true;
		const productionSite = createSyncSite( {
			id: 101,
			localSiteId: '',
			syncSupport: 'syncable',
			name: 'Linked Workspace',
			url: 'https://production.example',
			stagingSiteIds: [ 202 ],
		} );
		const stagingSite = createSyncSite( {
			id: 202,
			localSiteId: selectedSite.id,
			syncSupport: 'already-connected',
			name: 'Linked Workspace Staging',
			url: 'https://staging.example',
			isStaging: true,
			productionSiteId: 101,
		} );
		mockWpcomSitesQuery( [ productionSite, stagingSite ] );
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn( {
				selectedSite,
				sites: [ selectedSite ],
			} ),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		await user.click( screen.getByRole( 'tab', { name: 'Sync' } ) );

		expect( screen.getAllByText( 'Linked Workspace' ).length ).toBeGreaterThan( 0 );
		expect(
			screen.getByText( 'Connect this site to the local site before syncing.' )
		).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Connect' } ) ).toBeEnabled();
		expect( screen.getByText( 'Linked Workspace Staging' ) ).toBeVisible();
	} );

	it( 'lets Production/Staging sync select specific source files', async () => {
		const user = userEvent.setup();
		const fetchChildren = vi.fn().mockResolvedValue( [
			{
				id: 'plugin-path',
				name: 'akismet',
				label: 'akismet',
				checked: false,
				type: 'plugin',
				pathId: 'cjI6,ZjI6YWtpc21ldC8=',
				path: '/wp-content/plugins/akismet/',
			},
		] );
		syncHooksMock.useLatestRewindId.mockReturnValue( {
			rewindId: '1234567890',
			isLoading: false,
			isError: false,
		} );
		syncHooksMock.useRemoteFileTree.mockReturnValue( {
			fetchChildren,
			isLoading: false,
			error: null,
		} );
		featureFlagsMock.enableWorkspaces = true;
		const productionSite = createSyncSite( {
			id: 101,
			localSiteId: selectedSite.id,
			syncSupport: 'already-connected',
			name: 'Linked Workspace',
			url: 'https://production.example',
			stagingSiteIds: [ 202 ],
		} );
		const stagingSite = createSyncSite( {
			id: 202,
			localSiteId: selectedSite.id,
			syncSupport: 'already-connected',
			name: 'Linked Workspace Staging',
			url: 'https://staging.example',
			isStaging: true,
			productionSiteId: 101,
		} );
		mockWpcomSitesQuery( [ productionSite, stagingSite ] );
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn( {
				selectedSite,
				sites: [ selectedSite ],
			} ),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		await user.click( screen.getByRole( 'tab', { name: 'Sync' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Pull to Production' } ) );
		await user.selectOptions(
			screen.getByRole( 'combobox', { name: 'Select files and folders to sync' } ),
			'specific'
		);

		const sourceFileCheckbox = await screen.findByRole( 'checkbox', { name: 'akismet' } );
		expect( fetchChildren ).toHaveBeenCalledWith( 202, '1234567890', '/wp-content/', false );
		expect( screen.getByRole( 'checkbox', { name: 'Database' } ) ).toBeDisabled();
		expect( screen.getByTestId( 'environment-sync-submit-button' ) ).toBeDisabled();

		await user.click( sourceFileCheckbox );

		expect( screen.getByTestId( 'environment-sync-submit-button' ) ).toBeEnabled();
	} );

	it( 'disables Production/Staging sync while a local workspace sync is running', async () => {
		const user = userEvent.setup();
		featureFlagsMock.enableWorkspaces = true;
		const productionSite = createSyncSite( {
			id: 101,
			localSiteId: selectedSite.id,
			syncSupport: 'already-connected',
			name: 'Linked Workspace',
			url: 'https://production.example',
			stagingSiteIds: [ 202 ],
		} );
		const stagingSite = createSyncSite( {
			id: 202,
			localSiteId: selectedSite.id,
			syncSupport: 'already-connected',
			name: 'Linked Workspace Staging',
			url: 'https://staging.example',
			isStaging: true,
			productionSiteId: 101,
		} );
		mockWpcomSitesQuery( [ productionSite, stagingSite ] );
		store.dispatch(
			syncOperationsActions.updatePushState( {
				selectedSiteId: selectedSite.id,
				remoteSiteId: productionSite.id,
				state: {
					status: {
						key: 'uploading',
						progress: 40,
						message: 'Uploading site...',
					},
					selectedSite,
					remoteSiteUrl: productionSite.url,
				},
			} )
		);
		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			...createSiteDetailsReturn( {
				selectedSite,
				sites: [ selectedSite ],
			} ),
		} );

		await act( async () => renderWithProvider( <SiteContentTabs /> ) );
		await user.click( screen.getByRole( 'tab', { name: 'Sync' } ) );

		expect( screen.getByRole( 'button', { name: 'Push to Staging' } ) ).toBeDisabled();
		expect( screen.getByRole( 'button', { name: 'Pull to Production' } ) ).toBeDisabled();
	} );
} );
