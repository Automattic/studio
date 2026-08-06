// To run tests, execute `npm run test -- src/components/tests/content-tab-settings.test.tsx` from the root directory
import { UnknownAction } from '@reduxjs/toolkit';
import { Snapshot } from '@studio/common/types/snapshot';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { produce } from 'immer';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { ContentTabSettings } from 'src/components/content-tab-settings';
import { useGetWpVersion } from 'src/hooks/use-get-wp-version';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { createTestStore } from 'src/lib/test-utils';
import { RootState } from 'src/stores';
import { testReducer } from 'src/stores/tests/utils/test-reducer';

function snapshotTestReducer( state: RootState | undefined, action: UnknownAction ) {
	if ( action.type === 'snapshot/addSnapshot' ) {
		const payload = action.payload as {
			snapshot: Snapshot;
		};

		return produce( state!, ( draftState ) => {
			draftState.snapshot.snapshots.push( payload.snapshot );
		} );
	}

	return testReducer( state, action );
}

const snapshotTestActions = {
	addSnapshot: ( snapshot: Snapshot ) => {
		return { type: 'snapshot/addSnapshot', payload: { snapshot } };
	},
};

// Create test store
let testStore = createTestStore( {
	preloadedState: {
		betaFeatures: {
			features: { remoteSession: false, enableAgenticUi: false },
			loading: false,
		},
	},
} );

// We need to create a new store each time to avoid reducer conflicts
function createCustomTestStore() {
	const store = createTestStore( {
		preloadedState: {
			betaFeatures: {
				features: { remoteSession: false, enableAgenticUi: false },
				loading: false,
			},
		},
	} );
	store.replaceReducer( snapshotTestReducer );
	return store;
}

vi.mock( 'src/hooks/use-get-wp-version' );
vi.mock( 'src/hooks/use-site-details' );
vi.mock( 'src/lib/get-ipc-api' );
vi.mock( 'src/lib/app-globals', () => ( {
	isWindows: () => false,
	isLinux: () => false,
} ) );

vi.mock( 'src/stores/wordpress-versions-api', async () => {
	const actual = await vi.importActual( 'src/stores/wordpress-versions-api' );
	return {
		...actual,
		useGetWordPressVersions: vi.fn( () => ( {
			data: [
				{ label: 'Latest', value: 'latest', isBeta: false, isDevelopment: false },
				{ label: '6.4', value: '6.4', isBeta: false, isDevelopment: false },
				{ label: '6.3', value: '6.3', isBeta: false, isDevelopment: false },
			],
			isLoading: false,
		} ) ),
	};
} );

const selectedSite: SiteDetails = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	adminPassword: btoa( 'test-password' ),
	running: false,
	phpVersion: '8.4',
	id: 'site-id',
};

function renderWithProvider( component: React.ReactElement ) {
	return render( <Provider store={ testStore }>{ component }</Provider> );
}

function rerenderWithProvider(
	rerender: ( component: React.ReactElement ) => void,
	component: React.ReactElement
) {
	rerender( <Provider store={ testStore }>{ component }</Provider> );
}

describe( 'ContentTabSettings', () => {
	const copyText = vi.fn();
	const openLocalPath = vi.fn();
	const getAbsolutePathFromSite = vi.fn().mockResolvedValue( null );
	const generateProposedSitePath = vi.fn();
	const getAllCustomDomains = vi.fn().mockResolvedValue( [] );
	const getXdebugEnabledSite = vi.fn().mockResolvedValue( null );
	const mockSnapshot = {
		localSiteId: selectedSite.id,
		url: 'http://localhost:8881',
		date: Date.now(),
		name: 'Test Snapshot',
		sequence: 1,
		atomicSiteId: 1,
	};

	beforeEach( () => {
		vi.clearAllMocks();

		// Create a fresh store for each test (includes xdebugSupport: true)
		testStore = createCustomTestStore();

		vi.mocked( useGetWpVersion ).mockReturnValue( [ '7.7.7', vi.fn() ] );
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			copyText,
			openLocalPath,
			getAbsolutePathFromSite,
			generateProposedSitePath,
			getAllCustomDomains,
			getXdebugEnabledSite,
			isCATrusted: vi.fn( () => Promise.resolve( true ) ),
			executeWPCLiInline: vi.fn( () => Promise.resolve( { stdout: '', stderr: '', exitCode: 0 } ) ),
		} );

		vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
			selectedSite,
			uploadingSites: {},
			deleteSite: vi.fn(),
			isDeleting: false,
			updateSite: vi.fn(),
		} );
	} );

	test( 'renders site details correctly', async () => {
		renderWithProvider( <ContentTabSettings selectedSite={ selectedSite } /> );

		await waitFor( () => {
			expect( getAllCustomDomains ).toHaveBeenCalled();
		} );

		expect( screen.getByRole( 'heading', { name: 'Site details' } ) ).toBeVisible();
		expect( screen.getByText( 'Test Site' ) ).toBeVisible();
		expect(
			screen.getByRole( 'button', { name: 'localhost:8881, Copy site url to clipboard' } )
		).toHaveTextContent( 'localhost:8881' );
		expect( screen.getByText( 'HTTPS' ) ).toBeVisible();
		expect( screen.getByText( 'Xdebug' ) ).toBeVisible();
		// HTTPS, Xdebug, Debug log, Debug display, and Script debug show "Disabled"
		expect( screen.getAllByText( 'Disabled' ) ).toHaveLength( 5 );
		expect( screen.getByRole( 'button', { name: 'Copy local path to clipboard' } ) ).toBeVisible();
		expect( screen.getByText( '7.7.7' ) ).toBeVisible();
		expect(
			screen.getByRole( 'button', {
				name: 'localhost:8881/wp-admin/, Copy wp-admin url to clipboard',
			} )
		).toHaveTextContent( 'localhost:8881/wp-admin/' );
	} );

	test( 'allows copying the site path', async () => {
		const user = userEvent.setup();
		renderWithProvider( <ContentTabSettings selectedSite={ selectedSite } /> );

		await waitFor( () => {
			expect( getAllCustomDomains ).toHaveBeenCalled();
		} );

		const localPathButton = screen.getByRole( 'button', { name: 'Copy local path to clipboard' } );
		expect( localPathButton ).toBeVisible();
		await user.click( localPathButton );
		expect( copyText ).toHaveBeenCalledTimes( 1 );
		expect( copyText ).toHaveBeenCalledWith( '/path/to/site' );
	} );

	test( 'URL buttons work well when site is running', async () => {
		const user = userEvent.setup();
		const selectedSiteRunning: SiteDetails = {
			...selectedSite,
			port: 8881,
			url: 'http://localhost:8881',
			running: true,
		};
		renderWithProvider( <ContentTabSettings selectedSite={ selectedSiteRunning } /> );

		await waitFor( () => {
			expect( getAllCustomDomains ).toHaveBeenCalled();
		} );

		const urlButton = screen.getByRole( 'button', {
			name: 'localhost:8881, Copy site url to clipboard',
		} );
		expect( urlButton ).toBeVisible();
		await user.click( urlButton );
		expect( copyText ).toHaveBeenCalledTimes( 1 );
		expect( copyText ).toHaveBeenCalledWith( 'http://localhost:8881' );

		const wpAdminButton = screen.getByRole( 'button', {
			name: 'localhost:8881/wp-admin/, Copy wp-admin url to clipboard',
		} );
		expect( wpAdminButton ).toBeVisible();
		await user.click( wpAdminButton );
		expect( copyText ).toHaveBeenCalledTimes( 2 );
		expect( copyText ).toHaveBeenCalledWith( 'http://localhost:8881/wp-admin/' );
	} );

	test( 'allows copying the site password', async () => {
		const user = userEvent.setup();
		renderWithProvider( <ContentTabSettings selectedSite={ selectedSite } /> );

		await waitFor( () => {
			expect( getAllCustomDomains ).toHaveBeenCalled();
		} );

		const adminPasswordButton = screen.getByRole( 'button', {
			name: 'Copy admin password to clipboard',
		} );
		expect( adminPasswordButton ).toBeVisible();
		await user.click( adminPasswordButton );
		expect( copyText ).toHaveBeenCalledTimes( 1 );
		expect( copyText ).toHaveBeenCalledWith( 'test-password' );
	} );

	describe( 'when a legacy site lacks a stored password', () => {
		test( 'allows copying the default password', async () => {
			const user = userEvent.setup();
			const { adminPassword, ...selectedSiteLegacy }: SiteDetails = selectedSite;
			renderWithProvider( <ContentTabSettings selectedSite={ selectedSiteLegacy } /> );

			const adminPasswordButton = screen.getByRole( 'button', {
				name: 'Copy admin password to clipboard',
			} );
			expect( adminPasswordButton ).toBeVisible();
			await user.click( adminPasswordButton );
			expect( copyText ).toHaveBeenCalledTimes( 1 );
			expect( copyText ).toHaveBeenCalledWith( 'password' );
		} );
	} );

	describe( 'Debug log', () => {
		test( 'does not show "Open log file" button when debug log is disabled', async () => {
			renderWithProvider( <ContentTabSettings selectedSite={ selectedSite } /> );
			await waitFor( () => {
				expect( getAllCustomDomains ).toHaveBeenCalled();
			} );
			expect( screen.queryByRole( 'button', { name: 'Open log file' } ) ).not.toBeInTheDocument();
		} );

		test( 'does not show "Open log file" button when debug log is enabled but file does not exist', async () => {
			getAbsolutePathFromSite.mockResolvedValue( null );
			const siteWithDebugLog = { ...selectedSite, enableDebugLog: true };
			renderWithProvider( <ContentTabSettings selectedSite={ siteWithDebugLog } /> );
			await waitFor( () => {
				expect( getAbsolutePathFromSite ).toHaveBeenCalledWith( 'site-id', 'wp-content/debug.log' );
			} );
			expect( screen.queryByRole( 'button', { name: 'Open log file' } ) ).not.toBeInTheDocument();
		} );

		test( 'shows "Open log file" button when debug log is enabled and file exists', async () => {
			getAbsolutePathFromSite.mockResolvedValue( '/path/to/site/wp-content/debug.log' );
			const siteWithDebugLog = { ...selectedSite, enableDebugLog: true };
			renderWithProvider( <ContentTabSettings selectedSite={ siteWithDebugLog } /> );
			await waitFor( () => {
				expect( screen.getByRole( 'button', { name: 'Open log file' } ) ).toBeVisible();
			} );
		} );

		test( 'opens debug log file when button is clicked', async () => {
			const user = userEvent.setup();
			getAbsolutePathFromSite.mockResolvedValue( '/path/to/site/wp-content/debug.log' );
			const siteWithDebugLog = { ...selectedSite, enableDebugLog: true };
			renderWithProvider( <ContentTabSettings selectedSite={ siteWithDebugLog } /> );
			await waitFor( () => {
				expect( screen.getByRole( 'button', { name: 'Open log file' } ) ).toBeVisible();
			} );
			await user.click( screen.getByRole( 'button', { name: 'Open log file' } ) );
			expect( openLocalPath ).toHaveBeenCalledWith( '/path/to/site/wp-content/debug.log' );
		} );
	} );

	describe( 'PHP version', () => {
		it( 'shows a native PHP fallback warning for unsupported stored PHP versions', async () => {
			const user = userEvent.setup();

			renderWithProvider(
				<ContentTabSettings
					selectedSite={ { ...selectedSite, runtime: 'native-php', phpVersion: '7.4' } }
				/>
			);

			await waitFor( () => {
				expect( getAllCustomDomains ).toHaveBeenCalled();
			} );
			await user.hover( screen.getByRole( 'img', { name: 'PHP version warning' } ) );

			expect(
				await screen.findByText(
					'Native PHP does not support PHP 7.4. This site will run with PHP 8.2 instead.'
				)
			).toBeVisible();
		} );

		it( 'changes PHP version when site is not running', async () => {
			const user = userEvent.setup();

			const updateSite = vi.fn();
			const startServer = vi.fn();
			const stopServer = vi.fn();

			testStore.dispatch( snapshotTestActions.addSnapshot( mockSnapshot ) );

			// Mock snapshots to include a snapshot for the selected site
			vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
				selectedSite: { ...selectedSite, running: false } as SiteDetails,
				updateSite,
				startServer,
				stopServer,
				isEditModalOpen: false,
				setIsEditModalOpen: vi.fn(),
				editModalInitialTab: 'general',
				setEditModalInitialTab: vi.fn(),
			} );

			const { rerender } = renderWithProvider(
				<ContentTabSettings selectedSite={ selectedSite } />
			);
			expect( screen.getByText( '8.4' ) ).toBeVisible();
			await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );
			vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
				selectedSite: { ...selectedSite, running: false } as SiteDetails,
				updateSite,
				startServer,
				stopServer,
				isEditModalOpen: true,
				setIsEditModalOpen: vi.fn(),
				editModalInitialTab: 'general',
				setEditModalInitialTab: vi.fn(),
			} );
			rerenderWithProvider( rerender, <ContentTabSettings selectedSite={ selectedSite } /> );
			await waitFor( () => {
				expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
			} );

			const dialog = screen.getByRole( 'dialog' );
			expect( dialog ).toBeVisible();
			await user.selectOptions( within( dialog ).getByLabelText( 'PHP version' ), '8.2' );
			await user.click(
				within( dialog ).getByRole( 'button', {
					name: 'Save',
				} )
			);

			vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
				selectedSite: { ...selectedSite, running: false } as SiteDetails,
				updateSite,
				startServer,
				stopServer,
				isEditModalOpen: false,
				setIsEditModalOpen: vi.fn(),
				editModalInitialTab: 'general',
				setEditModalInitialTab: vi.fn(),
			} );
			rerenderWithProvider( rerender, <ContentTabSettings selectedSite={ selectedSite } /> );

			await waitFor( () => {
				expect( updateSite ).toHaveBeenCalledWith(
					expect.objectContaining( { phpVersion: '8.2' } ),
					undefined
				);
				expect( stopServer ).not.toHaveBeenCalled();
				expect( startServer ).not.toHaveBeenCalled();
			} );

			rerenderWithProvider(
				rerender,
				<ContentTabSettings selectedSite={ { ...selectedSite, phpVersion: '8.2' } } />
			);
			await waitFor( () => {
				expect( screen.getByText( '8.2' ) ).toBeVisible();
			} );
		} );

		it( 'changes PHP version and restarts site when site is running', async () => {
			const user = userEvent.setup();

			const updateSite = vi.fn();
			const startServer = vi.fn();
			const stopServer = vi.fn();
			// Mock snapshots to include a snapshot for the selected site
			testStore.dispatch( snapshotTestActions.addSnapshot( mockSnapshot ) );
			vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
				selectedSite: { ...selectedSite, running: true } as SiteDetails,
				updateSite,
				startServer,
				stopServer,
				isEditModalOpen: false,
				setIsEditModalOpen: vi.fn(),
				editModalInitialTab: 'general',
				setEditModalInitialTab: vi.fn(),
			} );

			const { rerender } = renderWithProvider(
				<ContentTabSettings selectedSite={ selectedSite } />
			);
			expect( screen.getByText( '8.4' ) ).toBeVisible();
			await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );
			vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
				selectedSite: { ...selectedSite, running: true } as SiteDetails,
				updateSite,
				startServer,
				stopServer,
				isEditModalOpen: true,
				setIsEditModalOpen: vi.fn(),
				editModalInitialTab: 'general',
				setEditModalInitialTab: vi.fn(),
			} );
			rerenderWithProvider( rerender, <ContentTabSettings selectedSite={ selectedSite } /> );
			await waitFor( () => {
				expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
			} );
			const dialog = screen.getByRole( 'dialog' );
			expect( dialog ).toBeVisible();
			await user.selectOptions( within( dialog ).getByLabelText( 'PHP version' ), '8.2' );
			await user.click(
				within( dialog ).getByRole( 'button', {
					name: 'Save',
				} )
			);

			vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
				selectedSite: { ...selectedSite, running: true } as SiteDetails,
				updateSite,
				startServer,
				stopServer,
				isEditModalOpen: false,
				setIsEditModalOpen: vi.fn(),
				editModalInitialTab: 'general',
				setEditModalInitialTab: vi.fn(),
			} );
			rerenderWithProvider( rerender, <ContentTabSettings selectedSite={ selectedSite } /> );

			await waitFor( () => {
				expect( updateSite ).toHaveBeenCalledWith(
					expect.objectContaining( { phpVersion: '8.2' } ),
					undefined
				);
			} );

			rerenderWithProvider(
				rerender,
				<ContentTabSettings selectedSite={ { ...selectedSite, phpVersion: '8.2' } } />
			);
			await waitFor( () => {
				expect( screen.getByText( '8.2' ) ).toBeVisible();
			} );
		} );
	} );
} );
