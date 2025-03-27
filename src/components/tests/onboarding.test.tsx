// Run tests: yarn test -- src/components/onboarding.test.tsx
import { jest } from '@jest/globals';
import { render, waitFor, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import Onboarding from 'src/components/onboarding';
import { useAddSite } from 'src/hooks/use-add-site';
import { useOffline } from 'src/hooks/use-offline';
import { useOnboarding } from 'src/hooks/use-onboarding';
import { FolderDialogResponse } from 'src/ipc-handlers';
import { useGetWordPressVersions } from 'src/stores/wordpress-versions-api';
import { DEFAULT_WORDPRESS_VERSION } from 'vendor/wp-now/src/constants';

jest.mock( 'src/hooks/use-onboarding', () => ( {
	useOnboarding: jest.fn(),
} ) );

jest.mock( 'src/hooks/use-add-site', () => ( {
	useAddSite: jest.fn(),
} ) );

jest.mock( 'src/hooks/use-feature-flags' );

jest.mock( 'src/lib/app-globals', () => ( {
	isMac: () => true,
	isWindows: () => false,
} ) );

jest.mock( 'src/hooks/use-offline', () => ( {
	useOffline: jest.fn().mockReturnValue( false ),
} ) );

jest.mock( 'src/stores/wordpress-versions-api', () => ( {
	useGetWordPressVersions: jest.fn( () => ( {
		data: [
			{ isBeta: false, isDevelopment: false, label: '6.3', value: '6.3.3' },
			{ isBeta: false, isDevelopment: false, label: '6.2', value: '6.2.0' },
			{ isBeta: false, isDevelopment: false, label: '6.1', value: '6.1.7' },
		],
		isLoading: false,
	} ) ),
} ) );

const mockGenerateProposedSitePath =
	jest.fn< ( siteName: string ) => Promise< FolderDialogResponse > >();

jest.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		generateProposedSitePath: mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/default_path/My Site',
			name: 'My Site',
			isEmpty: true,
			isWordPress: false,
		} ),
		promptWindowsSpeedUpSites: jest.fn(),
		openURL: jest.fn(),
		isCATrusted: jest.fn( () => Promise.resolve( true ) ),
	} ),
} ) );

const mockCreateSite = jest.fn();

describe( 'Onboarding Component', () => {
	const user = userEvent.setup();
	const useAddSiteMockValue = {
		setSiteName: jest.fn(),
		setProposedSitePath: jest.fn(),
		setSitePath: jest.fn(),
		setError: jest.fn(),
		setDoesPathContainWordPress: jest.fn(),
		setPhpVersion: jest.fn(),
		setWpVersion: jest.fn(),
		siteName: 'My Site',
		sitePath: '/path/to/my/site',
		phpVersion: '8.0',
		wpVersion: DEFAULT_WORDPRESS_VERSION,
		error: '',
		doesPathContainWordPress: false,
		handleAddSiteClick: jest.fn(),
		handleSiteNameChange: jest.fn(),
		handlePathSelectorClick: jest.fn(),
		onSelectPath: jest.fn(),
		setFileForImport: jest.fn(),
		fileForImport: null,
		isAdvancedSettingsVisible: true,
		handleSubmit: jest.fn( () => {
			mockCreateSite( '/path/to/my/site', 'My Site', DEFAULT_WORDPRESS_VERSION );
		} ),
		setUseCustomDomain: jest.fn(),
		useCustomDomain: false,
		customDomain: '',
		setCustomDomain: jest.fn(),
		setCustomDomainError: jest.fn(),
		customDomainError: '',
		enableHttps: false,
		setEnableHttps: jest.fn(),
		loadAllCustomDomains: jest.fn(),
	};

	beforeEach( () => {
		jest.clearAllMocks();

		( useOnboarding as jest.Mock ).mockReturnValue( {
			needsOnboarding: true,
		} );
		( useAddSite as jest.Mock ).mockReturnValue( useAddSiteMockValue );
	} );

	it( 'renders onboarding screen correctly', () => {
		const { getByText } = render( <Onboarding /> );
		expect( getByText( 'Add your first site' ) ).toBeVisible();
		expect( getByText( 'Add site' ) ).toBeVisible();
	} );

	it( 'completes onboarding when the final button is clicked', async () => {
		const { handleAddSiteClick } = useAddSite();

		const { getByText } = render( <Onboarding /> );

		await user.click( getByText( 'Add site' ) );

		await waitFor( () => expect( handleAddSiteClick ).toHaveBeenCalled() );
	} );

	it( 'should use wpVersion from useAddSite hook', () => {
		render( <Onboarding /> );

		const mockUseAddSite = useAddSite as jest.Mock;
		expect( mockUseAddSite ).toHaveBeenCalled();
		const hookResult = mockUseAddSite() as { wpVersion: string };
		expect( hookResult.wpVersion ).toBe( DEFAULT_WORDPRESS_VERSION );
	} );

	it( 'should fetch WordPress versions', async () => {
		render( <Onboarding /> );

		await waitFor( () => {
			expect( useGetWordPressVersions ).toHaveBeenCalled();
		} );
	} );

	it( 'should provide setWpVersion function from useAddSite hook', async () => {
		const mockSetWpVersion = jest.fn();

		( useAddSite as jest.Mock ).mockReturnValue( {
			...useAddSiteMockValue,
			setWpVersion: mockSetWpVersion,
		} );

		render( <Onboarding /> );

		expect( useAddSite().setWpVersion ).toBe( mockSetWpVersion );
	} );

	it( 'should display WordPress and PHP version dropdowns', async () => {
		render( <Onboarding /> );

		expect( screen.getByText( 'WordPress version' ) ).toBeInTheDocument();
		expect( screen.getByText( 'PHP version' ) ).toBeInTheDocument();

		const comboboxes = screen.getAllByRole( 'combobox' );
		expect( comboboxes.length ).toBeGreaterThanOrEqual( 2 );

		const phpVersionDropdown = comboboxes[ 0 ];
		expect( phpVersionDropdown ).toBeInTheDocument();

		const wpVersionDropdown = comboboxes[ 1 ];
		expect( wpVersionDropdown ).toBeInTheDocument();
	} );

	it( 'should allow selecting a different WordPress version', async () => {
		const mockHandleAddSiteClick = jest.fn().mockImplementation( () => {
			mockCreateSite( '/path/to/my/site', 'My Site', '6.3.3' );
			return Promise.resolve();
		} );

		( useAddSite as jest.Mock ).mockReturnValue( {
			...useAddSiteMockValue,
			handleAddSiteClick: mockHandleAddSiteClick,
			wpVersion: '6.3.3',
		} );

		render( <Onboarding /> );

		const comboboxes = screen.getAllByRole( 'combobox' );

		const wpVersionDropdown = comboboxes[ 1 ];

		await user.selectOptions( wpVersionDropdown, '6.3.3' );

		const addSiteButton = screen.getByText( 'Add site' );
		await user.click( addSiteButton );

		await waitFor( () => {
			expect( mockHandleAddSiteClick ).toHaveBeenCalled();
		} );

		await waitFor( () => {
			expect( mockCreateSite ).toHaveBeenCalledWith( '/path/to/my/site', 'My Site', '6.3.3' );
		} );
	} );

	it( 'should allow selecting a different PHP version', async () => {
		const mockSetPhpVersion = jest.fn();

		( useAddSite as jest.Mock ).mockReturnValue( {
			setSiteName: jest.fn(),
			setProposedSitePath: jest.fn(),
			setSitePath: jest.fn(),
			setError: jest.fn(),
			setDoesPathContainWordPress: jest.fn(),
			setPhpVersion: mockSetPhpVersion,
			setWpVersion: jest.fn(),
			siteName: 'My Site',
			sitePath: '/path/to/my/site',
			phpVersion: '8.2', // Changed from default
			wpVersion: DEFAULT_WORDPRESS_VERSION,
			error: '',
			doesPathContainWordPress: false,
			handleAddSiteClick: jest.fn(),
			handleSiteNameChange: jest.fn(),
			handlePathSelectorClick: jest.fn(),
			onSelectPath: jest.fn(),
			setFileForImport: jest.fn(),
			fileForImport: null,
			isAdvancedSettingsVisible: true,
			handleSubmit: jest.fn(),
			setUseCustomDomain: jest.fn(),
			useCustomDomain: false,
			customDomain: '',
			setCustomDomain: jest.fn(),
			setCustomDomainError: jest.fn(),
			customDomainError: '',
			enableHttps: false,
			setEnableHttps: jest.fn(),
			loadAllCustomDomains: jest.fn(),
		} );

		render( <Onboarding /> );

		const comboboxes = screen.getAllByRole( 'combobox' );

		const phpVersionDropdown = comboboxes[ 0 ];

		await user.selectOptions( phpVersionDropdown, '8.2' );

		expect( mockSetPhpVersion ).toHaveBeenCalled();
	} );

	it( 'should disable WordPress version field when offline', () => {
		( useOffline as jest.Mock ).mockReturnValue( true );

		render( <Onboarding /> );

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		expect( wpVersionSelect ).toBeDisabled();
	} );

	it( 'should enable WordPress version field when online', () => {
		( useOffline as jest.Mock ).mockReturnValue( false );

		render( <Onboarding /> );

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		expect( wpVersionSelect ).not.toBeDisabled();
	} );

	it( 'should show tooltip with offline message when hovering over disabled WordPress version field', async () => {
		( useOffline as jest.Mock ).mockReturnValue( true );

		render( <Onboarding /> );
		const user = userEvent.setup();

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		await user.hover( wpVersionSelect );

		expect(
			screen.getByText( 'Changing WordPress version requires an internet connection.' )
		).toBeInTheDocument();
	} );

	it( 'should not show tooltip when hovering over WordPress version field while online', async () => {
		( useOffline as jest.Mock ).mockReturnValue( false );

		render( <Onboarding /> );
		const user = userEvent.setup();

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		await user.hover( wpVersionSelect );

		expect(
			screen.queryByText( 'Changing WordPress version requires an internet connection.' )
		).not.toBeInTheDocument();
	} );
} );
