import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import EditSiteDetails from 'src/modules/site-settings/edit-site-details';

// Mock the hooks and dependencies
const mockUpdateSite = jest.fn();
const mockStopServer = jest.fn();
const mockStartServer = jest.fn();
const mockExecuteWPCLiInline = jest.fn();
const mockShowErrorMessageBox = jest.fn();

jest.mock( 'src/hooks/use-site-details', () => ( {
	useSiteDetails: () => ( {
		selectedSite: {
			id: 'site-123',
			name: 'Test Site',
			phpVersion: '8.0',
			running: true,
		},
		updateSite: mockUpdateSite,
		stopServer: mockStopServer,
		startServer: mockStartServer,
	} ),
} ) );

jest.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		executeWPCLiInline: mockExecuteWPCLiInline,
		showErrorMessageBox: mockShowErrorMessageBox,
	} ),
} ) );

jest.mock( '@wordpress/react-i18n', () => ( {
	useI18n: () => ( {
		__: ( text: string ) => text,
	} ),
} ) );

jest.mock( 'src/stores', () => ( {
	useRootSelector: jest.fn().mockImplementation( () => {
		// Mock the WordPress versions selector
		return [
			{ label: '6.4', value: '6.4' },
			{ label: '6.3', value: '6.3' },
			{ label: '6.2', value: '6.2' },
		];
	} ),
} ) );

describe( 'EditSiteDetails', () => {
	const defaultProps = {
		currentWpVersion: '6.3',
		onSave: jest.fn(),
	};

	beforeEach( () => {
		jest.clearAllMocks();
		mockExecuteWPCLiInline.mockResolvedValue( { exitCode: 0 } );
	} );

	it( 'should render the edit button', () => {
		render( <EditSiteDetails { ...defaultProps } /> );
		expect( screen.getByRole( 'button', { name: 'Edit site' } ) ).toBeInTheDocument();
	} );

	it( 'should open the modal when edit button is clicked', async () => {
		render( <EditSiteDetails { ...defaultProps } /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );

		expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		expect( screen.getByLabelText( 'Site name' ) ).toHaveValue( 'Test Site' );
		expect( screen.getByLabelText( 'PHP version' ) ).toHaveValue( '8.0' );
		expect( screen.getByLabelText( 'WordPress version' ) ).toHaveValue( '6.3' );
	} );

	it( 'should close the modal when cancel button is clicked', async () => {
		render( <EditSiteDetails { ...defaultProps } /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Cancel' } ) );

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );

	it( 'should disable the save button when no changes are made', async () => {
		render( <EditSiteDetails { ...defaultProps } /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();
	} );

	it( 'should enable the save button when site name is changed', async () => {
		render( <EditSiteDetails { ...defaultProps } /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );

		const siteNameInput = screen.getByLabelText( 'Site name' );
		await user.clear( siteNameInput );
		await user.type( siteNameInput, 'New Site Name' );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeEnabled();
	} );

	it( 'should enable the save button when PHP version is changed', async () => {
		render( <EditSiteDetails { ...defaultProps } /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );

		const phpVersionSelect = screen.getByLabelText( 'PHP version' );
		await user.selectOptions( phpVersionSelect, '8.2' );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeEnabled();
	} );

	it( 'should enable the save button when WordPress version is changed', async () => {
		render( <EditSiteDetails { ...defaultProps } /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		await user.selectOptions( wpVersionSelect, '6.4' );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeEnabled();
	} );

	it( 'should disable the save button when site name is empty', async () => {
		render( <EditSiteDetails { ...defaultProps } /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );

		const siteNameInput = screen.getByLabelText( 'Site name' );
		await user.clear( siteNameInput );

		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();
	} );

	it( 'should update site when save button is clicked with changed site name', async () => {
		render( <EditSiteDetails { ...defaultProps } /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );

		const siteNameInput = screen.getByLabelText( 'Site name' );
		await user.clear( siteNameInput );
		await user.type( siteNameInput, 'New Site Name' );

		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );

		expect( mockUpdateSite ).toHaveBeenCalledWith( {
			id: 'site-123',
			name: 'New Site Name',
			phpVersion: '8.0',
			running: true,
		} );
		expect( defaultProps.onSave ).toHaveBeenCalled();
	} );

	it( 'should update site and restart server when PHP version is changed', async () => {
		render( <EditSiteDetails { ...defaultProps } /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );

		const phpVersionSelect = screen.getByLabelText( 'PHP version' );
		await user.selectOptions( phpVersionSelect, '8.2' );

		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );

		expect( mockStopServer ).toHaveBeenCalledWith( 'site-123' );
		expect( mockUpdateSite ).toHaveBeenCalledWith( {
			id: 'site-123',
			name: 'Test Site',
			phpVersion: '8.2',
			running: true,
		} );
		expect( mockStartServer ).toHaveBeenCalledWith( 'site-123' );
		expect( defaultProps.onSave ).toHaveBeenCalled();
	} );

	it( 'should update WordPress version when changed', async () => {
		render( <EditSiteDetails { ...defaultProps } /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		await user.selectOptions( wpVersionSelect, '6.4' );

		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );

		expect( mockStopServer ).toHaveBeenCalledWith( 'site-123' );
		expect( mockExecuteWPCLiInline ).toHaveBeenCalledWith( {
			siteId: 'site-123',
			args: 'core update --version=6.4 --force',
			skipPluginsAndThemes: true,
		} );
		expect( mockUpdateSite ).toHaveBeenCalledWith( {
			id: 'site-123',
			name: 'Test Site',
			phpVersion: '8.0',
			running: true,
		} );
		expect( mockStartServer ).toHaveBeenCalledWith( 'site-123' );
		expect( defaultProps.onSave ).toHaveBeenCalled();
	} );

	it( 'should show error when WordPress version update fails', async () => {
		mockExecuteWPCLiInline.mockResolvedValue( { exitCode: 1, stderr: 'Update failed' } );

		render( <EditSiteDetails { ...defaultProps } /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		await user.selectOptions( wpVersionSelect, '6.4' );

		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () => {
			expect( mockShowErrorMessageBox ).toHaveBeenCalledWith( {
				title: 'Error changing WordPress version',
				message: 'Update failed',
			} );
		} );

		expect( screen.getByText( 'Error changing WordPress version' ) ).toBeInTheDocument();
	} );

	it( 'should disable form controls when site is being edited', async () => {
		// Mock the updateSite to delay completion
		mockUpdateSite.mockImplementation(
			() => new Promise( ( resolve ) => setTimeout( resolve, 100 ) )
		);

		render( <EditSiteDetails { ...defaultProps } /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );

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
} );
