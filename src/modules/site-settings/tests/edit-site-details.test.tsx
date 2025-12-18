import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { useOffline } from 'src/hooks/use-offline';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { createTestStore } from 'src/lib/test-utils';
import EditSiteDetails from 'src/modules/site-settings/edit-site-details';
import { useGetWordPressVersions } from 'src/stores/wordpress-versions-api';

// Mock the hooks and dependencies
const mockUpdateSite = jest.fn();
const mockStopServer = jest.fn();
const mockStartServer = jest.fn();
const mockExecuteWPCLiInline = jest.fn();
const mockShowErrorMessageBox = jest.fn();
const mockGetAllCustomDomains = jest.fn().mockResolvedValue( [] );

jest.mock( 'src/lib/app-globals', () => ( {
	isWindows: () => false,
} ) );

jest.mock( 'src/hooks/use-site-details' );

jest.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		executeWPCLiInline: mockExecuteWPCLiInline,
		showErrorMessageBox: mockShowErrorMessageBox,
		getAllCustomDomains: mockGetAllCustomDomains,
		isCATrusted: jest.fn( () => Promise.resolve( true ) ),
	} ),
} ) );

jest.mock( '@wordpress/react-i18n', () => ( {
	useI18n: () => ( {
		__: ( text: string ) => text,
	} ),
} ) );

jest.mock( 'src/stores/wordpress-versions-api', () => {
	const actual = jest.requireActual( 'src/stores/wordpress-versions-api' );
	return {
		...actual,
		useGetWordPressVersions: jest.fn( () => ( {
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

jest.mock( 'src/stores/certificate-trust-api', () => {
	const actual = jest.requireActual( 'src/stores/certificate-trust-api' );
	return {
		...actual,
		useCheckCertificateTrustQuery: jest.fn().mockReturnValue( { data: true } ),
	};
} );

jest.mock( 'src/hooks/use-offline', () => ( {
	useOffline: jest.fn().mockReturnValue( false ),
} ) );

const renderWithProvider = ( children: React.ReactElement ) => {
	const store = createTestStore();
	return render( <Provider store={ store }>{ children }</Provider> );
};

describe( 'EditSiteDetails', () => {
	const defaultProps = {
		currentWpVersion: '6.3',
		onSave: jest.fn(),
	};

	beforeEach( () => {
		jest.clearAllMocks();
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			selectedSite: {
				id: 'site-123',
				name: 'Test Site',
				phpVersion: '8.3',
				wpVersion: 'latest',
				running: true,
			},
			updateSite: mockUpdateSite,
			stopServer: mockStopServer,
			startServer: mockStartServer,
			setIsEditModalOpen: jest.fn(),
			isEditModalOpen: false,
		} );
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

		( useSiteDetails as jest.Mock ).mockReturnValue( {
			...useSiteDetails(),
			isEditModalOpen: true,
		} );

		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );

		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );

		expect( screen.getByLabelText( 'Site name' ) ).toHaveValue( 'Test Site' );
		expect( screen.getByLabelText( 'PHP version' ) ).toHaveValue( '8.3' );
		expect( screen.getByLabelText( 'WordPress version' ) ).toHaveValue( 'latest' );
	} );

	it( 'should close the modal when cancel button is clicked', async () => {
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( mockGetAllCustomDomains ).toHaveBeenCalled();
		} );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );
		expect( useSiteDetails().setIsEditModalOpen ).toHaveBeenCalledWith( true );

		( useSiteDetails as jest.Mock ).mockReturnValue( {
			...useSiteDetails(),
			isEditModalOpen: true,
		} );
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );

		await user.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		expect( useSiteDetails().setIsEditModalOpen ).toHaveBeenCalledWith( false );
	} );

	it( 'should disable the save button when no changes are made', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			...useSiteDetails(),
			isEditModalOpen: true,
		} );
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( mockGetAllCustomDomains ).toHaveBeenCalled();
		} );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();
	} );

	it( 'should enable the save button when site name is changed', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			...useSiteDetails(),
			isEditModalOpen: true,
		} );
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
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			...useSiteDetails(),
			isEditModalOpen: true,
		} );
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( mockGetAllCustomDomains ).toHaveBeenCalled();
		} );
		const user = userEvent.setup();

		const phpVersionSelect = screen.getByLabelText( 'PHP version' );
		await user.selectOptions( phpVersionSelect, '8.2' );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeEnabled();
	} );

	it( 'should enable the save button when WordPress version is changed', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			...useSiteDetails(),
			isEditModalOpen: true,
		} );
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( mockGetAllCustomDomains ).toHaveBeenCalled();
		} );
		const user = userEvent.setup();

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		await user.selectOptions( wpVersionSelect, '6.4' );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeEnabled();
	} );

	it( 'should disable the save button when site name is empty', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			...useSiteDetails(),
			isEditModalOpen: true,
		} );
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
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			...useSiteDetails(),
			isEditModalOpen: true,
		} );
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

	it( 'should update site and restart server when PHP version is changed', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			...useSiteDetails(),
			isEditModalOpen: true,
		} );
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( mockGetAllCustomDomains ).toHaveBeenCalled();
		} );
		const user = userEvent.setup();

		const phpVersionSelect = screen.getByLabelText( 'PHP version' );
		await user.selectOptions( phpVersionSelect, '8.2' );

		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () => {
			expect( mockStopServer ).toHaveBeenCalledWith( 'site-123' );
			expect( mockUpdateSite ).toHaveBeenCalled();
			expect( mockUpdateSite.mock.calls[ 0 ][ 0 ].phpVersion ).toBe( '8.2' );
			expect( mockStartServer ).toHaveBeenCalledWith( 'site-123' );
			expect( defaultProps.onSave ).toHaveBeenCalled();
		} );
	} );

	it( 'should update isWpAutoUpdating to false when changed from latest to specific version', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			...useSiteDetails(),
			isEditModalOpen: true,
		} );
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );
		const user = userEvent.setup();

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		await user.selectOptions( wpVersionSelect, '6.4' );

		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );

		expect( mockStopServer ).toHaveBeenCalledWith( 'site-123' );
		expect( mockExecuteWPCLiInline ).toHaveBeenCalledWith( {
			siteId: 'site-123',
			args: 'core update https://wordpress.org/wordpress-6.4.zip --force',
			skipPluginsAndThemes: true,
		} );
		expect( mockUpdateSite ).toHaveBeenCalled();
		expect( mockUpdateSite.mock.calls[ 0 ][ 0 ].isWpAutoUpdating ).toBe( false );
		expect( mockStartServer ).toHaveBeenCalledWith( 'site-123' );
		expect( defaultProps.onSave ).toHaveBeenCalled();
	} );

	it( 'should update WordPress version when changed to beta', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			...useSiteDetails(),
			isEditModalOpen: true,
		} );
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );
		const user = userEvent.setup();

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		await user.selectOptions( wpVersionSelect, '6.8-beta1' );

		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );

		expect( mockExecuteWPCLiInline ).toHaveBeenCalledWith( {
			siteId: 'site-123',
			args: 'core update https://wordpress.org/wordpress-6.8-beta1.zip --force',
			skipPluginsAndThemes: true,
		} );
	} );

	it( 'should show error when WordPress version update fails', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			...useSiteDetails(),
			isEditModalOpen: true,
		} );
		const consoleSpy = jest.spyOn( console, 'error' ).mockImplementation( () => {} );
		mockExecuteWPCLiInline.mockResolvedValue( { exitCode: 1, stderr: 'Update failed' } );

		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );
		const user = userEvent.setup();

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		await user.selectOptions( wpVersionSelect, '6.4' );

		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () => {
			expect( mockShowErrorMessageBox ).toHaveBeenCalledWith( {
				title: 'Error changing WordPress version',
				message: 'An error occurred while updating the WordPress version.',
				error: new Error( 'Update failed' ),
				showOpenLogs: true,
			} );
		} );

		consoleSpy.mockRestore();
	} );

	it( 'should disable form controls when site is being edited', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			...useSiteDetails(),
			isEditModalOpen: true,
		} );
		// Mock the updateSite to delay completion
		mockUpdateSite.mockImplementation(
			() => new Promise( ( resolve ) => setTimeout( resolve, 100 ) )
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
		expect( screen.getByRole( 'button', { name: 'Saving…' } ) ).toBeInTheDocument();
		expect( screen.getByLabelText( 'Site name' ) ).toBeDisabled();
		expect( screen.getByLabelText( 'PHP version' ) ).toBeDisabled();
		expect( screen.getByLabelText( 'WordPress version' ) ).toBeDisabled();
		expect( screen.getByRole( 'button', { name: 'Cancel' } ) ).toBeDisabled();

		// Wait for the update to complete
		await waitFor( () => {
			expect( mockUpdateSite ).toHaveBeenCalled();
		} );
	} );

	it( 'should disable WordPress version field when offline', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			...useSiteDetails(),
			isEditModalOpen: true,
		} );
		( useOffline as jest.Mock ).mockReturnValue( true );

		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		expect( wpVersionSelect ).toBeDisabled();
	} );

	it( 'should enable WordPress version field when online', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			...useSiteDetails(),
			isEditModalOpen: true,
		} );
		( useOffline as jest.Mock ).mockReturnValue( false );

		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		expect( wpVersionSelect ).toBeEnabled();
	} );

	it( 'should show tooltip with offline message when hovering over disabled WordPress version field', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			...useSiteDetails(),
			isEditModalOpen: true,
		} );
		( useOffline as jest.Mock ).mockReturnValue( true );

		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );
		const user = userEvent.setup();

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		await user.hover( wpVersionSelect );

		expect(
			screen.getByText( 'Changing WordPress version requires an internet connection.' )
		).toBeInTheDocument();
	} );

	it( 'should not show tooltip when hovering over WordPress version field while online', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			...useSiteDetails(),
			isEditModalOpen: true,
		} );
		( useOffline as jest.Mock ).mockReturnValue( false );

		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		const user = userEvent.setup();

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		await user.hover( wpVersionSelect );

		expect(
			screen.queryByText( 'Changing WordPress version requires an internet connection.' )
		).not.toBeInTheDocument();
	} );

	it( 'should fetch WordPress versions when modal opens', async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			...useSiteDetails(),
			isEditModalOpen: true,
		} );
		renderWithProvider( <EditSiteDetails { ...defaultProps } /> );
		await waitFor( () => {
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		} );

		expect( useGetWordPressVersions ).toHaveBeenCalled();
	} );
} );
