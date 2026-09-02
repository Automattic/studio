import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { useOffline } from 'src/hooks/use-offline';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { createTestStore, createMock } from 'src/lib/test-utils';
import EditSiteDetails from 'src/modules/site-settings/edit-site-details';
import { useGetWordPressVersions } from 'src/stores/wordpress-versions-api';

// Mock the hooks and dependencies
const mockUpdateSite = vi.fn();
const mockStopServer = vi.fn();
const mockStartServer = vi.fn();
const mockExecuteWPCLiInline = vi.fn();
const mockShowErrorMessageBox = vi.fn();
const mockGetAllCustomDomains = vi.fn().mockResolvedValue( [] );
const mockGetXdebugEnabledSite = vi.fn().mockResolvedValue( null );

vi.mock( 'src/lib/app-globals', () => ( {
	isWindows: () => false,
	isLinux: () => false,
} ) );

vi.mock( 'src/hooks/use-site-details' );

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		executeWPCLiInline: mockExecuteWPCLiInline,
		showErrorMessageBox: mockShowErrorMessageBox,
		getAllCustomDomains: mockGetAllCustomDomains,
		getXdebugEnabledSite: mockGetXdebugEnabledSite,
		isCATrusted: vi.fn( () => Promise.resolve( true ) ),
	} ),
} ) );

vi.mock( '@wordpress/react-i18n', () => ( {
	useI18n: () => ( {
		__: ( text: string ) => text,
	} ),
} ) );

vi.mock( 'src/stores/wordpress-versions-api', async () => {
	const actual = await vi.importActual( 'src/stores/wordpress-versions-api' );
	return {
		...actual,
		useGetWordPressVersions: vi.fn( () => ( {
			data: [
				{ label: 'Latest', value: '6.7.2' },
				{ label: '6.8-beta1', value: '6.8-beta1', isBeta: true, isDevelopment: false },
				{ label: '6.4', value: '6.4', isBeta: false, isDevelopment: false },
				{ label: '6.3', value: '6.3', isBeta: false, isDevelopment: false },
				{ label: '6.2', value: '6.2', isBeta: false, isDevelopment: false },
			],
			isLoading: false,
		} ) ),
	};
} );

vi.mock( 'src/stores/certificate-trust-api', async () => {
	const actual = await vi.importActual( 'src/stores/certificate-trust-api' );
	return {
		...actual,
		useCheckCertificateTrustQuery: vi.fn().mockReturnValue( { data: true } ),
	};
} );

vi.mock( 'src/hooks/use-offline', () => ( {
	useOffline: vi.fn().mockReturnValue( false ),
} ) );

/** New sites and auto-updating sites hide the picker behind the toggle. */
const pinVersion = async (
	user: ReturnType< typeof userEvent.setup >,
	version: string
): Promise< void > => {
	await user.click( screen.getByLabelText( 'Automatic updates' ) );
	await user.selectOptions( screen.getByLabelText( 'Version' ), version );
};

const renderWithProvider = ( children: React.ReactElement ) => {
	const store = createTestStore( {
		preloadedState: {
			betaFeatures: {
				features: { remoteSession: false, enableAgenticUi: false },
				loading: false,
			},
		},
	} );
	return render( <Provider store={ store }>{ children }</Provider> );
};

describe( 'EditSiteDetails', () => {
	const defaultProps = {
		currentWpVersion: '6.3',
		onSave: vi.fn(),
	};

	const baseMockSiteDetails = {
		selectedSite: {
			id: 'site-123',
			name: 'Test Site',
			path: '/path/to/site',
			port: 8881,
			phpVersion: '8.4',
			running: true,
			url: 'http://localhost:8881',
		},
		updateSite: mockUpdateSite,
		stopServer: mockStopServer,
		startServer: mockStartServer,
		setIsEditModalOpen: vi.fn(),
		isEditModalOpen: false,
		editModalInitialTab: 'general',
		setEditModalInitialTab: vi.fn(),
	};

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( baseMockSiteDetails )
		);
		mockExecuteWPCLiInline.mockResolvedValue( { exitCode: 0 } );
	} );

	it( 'should render the edit button', async () => {
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( mockGetAllCustomDomains ).toHaveBeenCalled();
		} );
		expect( screen.getByRole( 'button', { name: 'Edit site' } ) ).toBeInTheDocument();
	} );

	it( 'should open the modal when edit button is clicked', async () => {
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( mockGetAllCustomDomains ).toHaveBeenCalled();
		} );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );

		expect( useSiteDetails().setIsEditModalOpen ).toHaveBeenCalledWith( true );

		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				isEditModalOpen: true,
			} )
		);

		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );

		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );

		expect( screen.getByLabelText( 'Site name' ) ).toHaveValue( 'Test Site' );
		expect( screen.getByLabelText( 'PHP version' ) ).toHaveValue( '8.4' );
		const toggle = screen.getByLabelText( 'Automatic updates' );
		expect( toggle ).toBeChecked();
		expect( screen.getByText( /Installed version/ ) ).toHaveTextContent( 'Installed version: 6.3' );
		// Forms mode announces only the control's label and description, so both
		// lines under the toggle have to be part of that description.
		expect( toggle ).toHaveAccessibleDescription( /Installed version: 6\.3/ );
		expect( toggle ).toHaveAccessibleDescription( /on its own schedule/ );
		// Nothing to pick while WordPress owns the version.
		expect( screen.queryByLabelText( 'Version' ) ).not.toBeInTheDocument();
	} );

	it( 'should show the version picker for pinned sites', async () => {
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				selectedSite: { ...baseMockSiteDetails.selectedSite, isWpAutoUpdating: false },
				isEditModalOpen: true,
			} )
		);

		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );

		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );

		expect( screen.getByLabelText( 'Automatic updates' ) ).not.toBeChecked();
		expect( screen.getByLabelText( 'Version' ) ).toHaveValue( '6.3' );
		expect( screen.getByRole( 'group', { name: 'Stable Versions' } ) ).toBeInTheDocument();
		// Naming the installed version beside "Automatic updates" on a pinned
		// site would read as if auto-update were keeping it there (STU-2348).
		expect( screen.queryByText( /Installed version/ ) ).not.toBeInTheDocument();
	} );

	it( 'should name the installed version as soon as a pinned site turns auto-update on', async () => {
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				selectedSite: { ...baseMockSiteDetails.selectedSite, isWpAutoUpdating: false },
				isEditModalOpen: true,
			} )
		);

		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );

		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );

		await userEvent.setup().click( screen.getByLabelText( 'Automatic updates' ) );

		expect( screen.getByText( /Installed version/ ) ).toHaveTextContent( 'Installed version: 6.3' );
	} );

	it( 'should close the modal when cancel button is clicked', async () => {
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( mockGetAllCustomDomains ).toHaveBeenCalled();
		} );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );
		expect( useSiteDetails().setIsEditModalOpen ).toHaveBeenCalledWith( true );

		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				isEditModalOpen: true,
			} )
		);
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );

		await user.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		expect( useSiteDetails().setIsEditModalOpen ).toHaveBeenCalledWith( false );
	} );

	it( 'should disable the save button when no changes are made', async () => {
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				isEditModalOpen: true,
			} )
		);
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( mockGetAllCustomDomains ).toHaveBeenCalled();
		} );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();
	} );

	it( 'should enable the save button when site name is changed', async () => {
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				isEditModalOpen: true,
			} )
		);
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( mockGetAllCustomDomains ).toHaveBeenCalled();
		} );
		const user = userEvent.setup();

		const siteNameInput = screen.getByLabelText( 'Site name' );
		await user.clear( siteNameInput );
		await user.type( siteNameInput, 'New Site Name' );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeEnabled();
	} );

	it( 'should enable the save button when PHP version is changed', async () => {
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				isEditModalOpen: true,
			} )
		);
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( mockGetAllCustomDomains ).toHaveBeenCalled();
		} );
		const user = userEvent.setup();

		const phpVersionSelect = screen.getByLabelText( 'PHP version' );
		await user.selectOptions( phpVersionSelect, '8.2' );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeEnabled();
	} );

	it( 'should show a fallback warning for unsupported stored PHP versions', async () => {
		const user = userEvent.setup();
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				selectedSite: {
					...baseMockSiteDetails.selectedSite,
					runtime: 'native-php',
					phpVersion: '7.4',
				},
				isEditModalOpen: true,
			} )
		);

		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );

		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );
		const dialog = screen.getByRole( 'dialog' );
		expect( within( dialog ).getByLabelText( 'PHP version' ) ).toHaveValue( '8.2' );
		await user.hover( within( dialog ).getByRole( 'img', { name: 'PHP version warning' } ) );

		expect(
			await screen.findByText(
				'PHP 7.4 is no longer supported. Saving will update this site to PHP 8.2.'
			)
		).toBeVisible();
	} );

	it( 'should enable the save button when WordPress version is changed', async () => {
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				isEditModalOpen: true,
			} )
		);
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( mockGetAllCustomDomains ).toHaveBeenCalled();
		} );
		const user = userEvent.setup();

		await pinVersion( user, '6.4' );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeEnabled();
	} );

	it( 'should disable the save button when site name is empty', async () => {
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				isEditModalOpen: true,
			} )
		);
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( mockGetAllCustomDomains ).toHaveBeenCalled();
		} );
		const user = userEvent.setup();

		const siteNameInput = screen.getByLabelText( 'Site name' );
		await user.clear( siteNameInput );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();
	} );

	it( 'should update site when save button is clicked with changed site name', async () => {
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				isEditModalOpen: true,
			} )
		);
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( mockGetAllCustomDomains ).toHaveBeenCalled();
		} );
		const user = userEvent.setup();

		const siteNameInput = screen.getByLabelText( 'Site name' );
		await user.clear( siteNameInput );
		await user.type( siteNameInput, 'New Site Name' );

		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () => {
			expect( mockUpdateSite ).toHaveBeenCalled();
			expect( mockUpdateSite.mock.calls[ 0 ][ 0 ].name ).toBe( 'New Site Name' );
			expect( defaultProps.onSave ).toHaveBeenCalled();
		} );
	} );

	it( 'should update site when PHP version is changed (CLI handles restart)', async () => {
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				isEditModalOpen: true,
			} )
		);
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( mockGetAllCustomDomains ).toHaveBeenCalled();
		} );
		const user = userEvent.setup();

		const phpVersionSelect = screen.getByLabelText( 'PHP version' );
		await user.selectOptions( phpVersionSelect, '8.2' );

		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () => {
			expect( mockUpdateSite ).toHaveBeenCalled();
			expect( mockUpdateSite.mock.calls[ 0 ][ 0 ].phpVersion ).toBe( '8.2' );
			expect( defaultProps.onSave ).toHaveBeenCalled();
		} );
	} );

	it( 'should update isWpAutoUpdating and pass wpVersion when changed from latest to specific version', async () => {
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				isEditModalOpen: true,
			} )
		);
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );
		const user = userEvent.setup();

		await pinVersion( user, '6.4' );

		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () => {
			expect( mockUpdateSite ).toHaveBeenCalled();
			expect( mockUpdateSite.mock.calls[ 0 ][ 0 ].isWpAutoUpdating ).toBe( false );
			// wpVersion is passed as second argument
			expect( mockUpdateSite.mock.calls[ 0 ][ 1 ] ).toBe( '6.4' );
			expect( defaultProps.onSave ).toHaveBeenCalled();
		} );
	} );

	it( 'should pass wpVersion when WordPress version is changed to beta', async () => {
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				isEditModalOpen: true,
			} )
		);
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );
		const user = userEvent.setup();

		await pinVersion( user, '6.8-beta1' );

		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () => {
			expect( mockUpdateSite ).toHaveBeenCalled();
			expect( mockUpdateSite.mock.calls[ 0 ][ 1 ] ).toBe( '6.8-beta1' );
		} );
	} );

	it( 'should show error when site update fails', async () => {
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				isEditModalOpen: true,
			} )
		);

		mockUpdateSite.mockRejectedValueOnce( new Error( 'CLI site set failed' ) );

		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );
		const user = userEvent.setup();

		await pinVersion( user, '6.4' );

		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () => {
			expect( screen.getByText( 'CLI site set failed' ) ).toBeInTheDocument();
		} );
	} );

	it( 'should disable form controls when site is being edited', async () => {
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				isEditModalOpen: true,
			} )
		);
		let resolveUpdate: () => void = () => {
			// Initial no-op reassigned when mockUpdateSite is invoked.
		};
		mockUpdateSite.mockImplementation(
			() =>
				new Promise< void >( ( resolve ) => {
					resolveUpdate = resolve;
				} )
		);

		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );
		const user = userEvent.setup();

		const siteNameInput = screen.getByLabelText( 'Site name' );
		await user.clear( siteNameInput );
		await user.type( siteNameInput, 'New Site Name' );

		const saveButton = screen.getByRole( 'button', { name: 'Save' } );
		await user.click( saveButton );

		// Check that controls are disabled during save
		await waitFor( () => {
			expect( screen.getByRole( 'button', { name: 'Saving…' } ) ).toBeInTheDocument();
		} );
		expect( screen.getByLabelText( 'Site name' ) ).toBeDisabled();
		expect( screen.getByLabelText( 'PHP version' ) ).toBeDisabled();
		expect( screen.getByLabelText( 'Automatic updates' ) ).toBeDisabled();
		expect( screen.getByRole( 'button', { name: 'Cancel' } ) ).toBeDisabled();

		resolveUpdate();

		// Wait for the update to complete
		await waitFor( () => {
			expect( mockUpdateSite ).toHaveBeenCalled();
		} );
	} );

	it( 'should disable WordPress version field when offline', async () => {
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				isEditModalOpen: true,
			} )
		);
		vi.mocked( useOffline ).mockReturnValue( true );

		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );

		expect( screen.getByLabelText( 'Automatic updates' ) ).toBeDisabled();
	} );

	it( 'should enable WordPress version field when online', async () => {
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				isEditModalOpen: true,
			} )
		);
		vi.mocked( useOffline ).mockReturnValue( false );

		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );

		expect( screen.getByLabelText( 'Automatic updates' ) ).toBeEnabled();
	} );

	it( 'should show tooltip with offline message when hovering over disabled WordPress version field', async () => {
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				isEditModalOpen: true,
			} )
		);
		vi.mocked( useOffline ).mockReturnValue( true );

		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );
		const user = userEvent.setup();

		await user.hover( screen.getByLabelText( 'Automatic updates' ) );

		expect(
			screen.getByText( 'Changing WordPress version requires an internet connection.' )
		).toBeInTheDocument();
	} );

	it( 'should not show tooltip when hovering over WordPress version field while online', async () => {
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				isEditModalOpen: true,
			} )
		);
		vi.mocked( useOffline ).mockReturnValue( false );

		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		const user = userEvent.setup();

		await user.hover( screen.getByLabelText( 'Automatic updates' ) );

		expect(
			screen.queryByText( 'Changing WordPress version requires an internet connection.' )
		).not.toBeInTheDocument();
	} );

	it( 'should fetch WordPress versions when modal opens', async () => {
		vi.mocked( useSiteDetails ).mockReturnValue(
			createMock< ReturnType< typeof useSiteDetails > >( {
				...baseMockSiteDetails,
				isEditModalOpen: true,
			} )
		);
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );

		expect( useGetWordPressVersions ).toHaveBeenCalled();
	} );
} );
