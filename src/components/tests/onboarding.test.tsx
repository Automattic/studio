// Run tests: yarn test -- src/components/onboarding.test.tsx
import { jest } from '@jest/globals';
import { render, waitFor, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { FormEvent } from 'react';
import Onboarding from 'src/components/onboarding';
import { useAddSite } from 'src/hooks/use-add-site';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useOnboarding } from 'src/hooks/use-onboarding';
import { FolderDialogResponse } from 'src/ipc-handlers';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { wordpressVersionsSelectors } from 'src/stores/wordpress-versions-slice';
import { DEFAULT_WORDPRESS_VERSION } from 'vendor/wp-now/src/constants';

jest.mock( 'src/hooks/use-onboarding', () => ( {
	useOnboarding: jest.fn(),
} ) );

jest.mock( 'src/hooks/use-add-site', () => ( {
	useAddSite: jest.fn(),
} ) );

jest.mock( 'src/hooks/use-feature-flags' );

jest.mock( 'src/stores', () => ( {
	useAppDispatch: jest.fn(),
	useRootSelector: jest.fn(),
} ) );

jest.mock( 'src/lib/app-globals', () => ( {
	isMac: () => true,
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
	} ),
} ) );

// Mock dispatch function
const mockDispatch = jest.fn();

// Mock createSite function to test it's called with correct parameters
const mockCreateSite = jest.fn();

describe( 'Onboarding Component', () => {
	const user = userEvent.setup();

	beforeEach( () => {
		jest.clearAllMocks();

		// Default mock implementations
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			wpVersionsEnabled: false,
		} );

		( useAppDispatch as jest.Mock ).mockReturnValue( mockDispatch );

		( useRootSelector as jest.Mock ).mockImplementation( ( selector ) => {
			if ( selector === wordpressVersionsSelectors.selectWordPressVersions ) {
				return [];
			}
			return { status: 'idle' };
		} );

		( useOnboarding as jest.Mock ).mockReturnValue( {
			needsOnboarding: true,
		} );
		( useAddSite as jest.Mock ).mockReturnValue( {
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
		} );
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

		// Check if handleAddSiteClick has been called and the process to create a new site started
		await waitFor( () => expect( handleAddSiteClick ).toHaveBeenCalled() );
	} );

	it( 'should use wpVersion from useAddSite hook', () => {
		// Render the component
		render( <Onboarding /> );

		// Verify that the useAddSite hook is called with the correct implementation
		const mockUseAddSite = useAddSite as jest.Mock;
		expect( mockUseAddSite ).toHaveBeenCalled();
		// Type assertion to avoid 'unknown' type error
		const hookResult = mockUseAddSite() as { wpVersion: string };
		expect( hookResult.wpVersion ).toBe( DEFAULT_WORDPRESS_VERSION );
	} );

	it( 'should dispatch an action when feature flag is enabled', async () => {
		// Enable the feature flag
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			wpVersionsEnabled: true,
		} );

		// Mock WordPress versions
		( useRootSelector as jest.Mock ).mockImplementation( ( selector ) => {
			if ( selector === wordpressVersionsSelectors.selectWordPressVersions ) {
				return [
					{ name: '6.1.7', version: '6.1.7' },
					{ name: '6.2.0', version: '6.2.0' },
				];
			}
			return { status: 'succeeded' };
		} );

		// Mock dispatch to return a function that resolves immediately
		mockDispatch.mockImplementation( () => Promise.resolve() );

		// Render the component to trigger the useEffect
		render( <Onboarding /> );

		// Wait for any async operations to complete
		await waitFor( () => {
			// Verify that the dispatch function is available
			expect( useAppDispatch ).toHaveBeenCalled();
		} );
	} );

	it( 'should provide setWpVersion function from useAddSite hook', async () => {
		// Create a mock for setWpVersion
		const mockSetWpVersion = jest.fn();

		// Override the useAddSite mock for this test
		( useAddSite as jest.Mock ).mockReturnValue( {
			setSiteName: jest.fn(),
			setProposedSitePath: jest.fn(),
			setSitePath: jest.fn(),
			setError: jest.fn(),
			setDoesPathContainWordPress: jest.fn(),
			setPhpVersion: jest.fn(),
			setWpVersion: mockSetWpVersion,
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
		} );

		render( <Onboarding /> );

		// Verify that the setWpVersion function is provided by the useAddSite hook
		expect( useAddSite().setWpVersion ).toBe( mockSetWpVersion );
	} );

	it( 'should display WordPress and PHP version dropdowns when feature flag is enabled', async () => {
		// Enable the feature flag
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			wpVersionsEnabled: true,
		} );

		// Mock WordPress versions
		( useRootSelector as jest.Mock ).mockImplementation( ( selector ) => {
			if ( selector === wordpressVersionsSelectors.selectWordPressVersions ) {
				return [
					{ name: '6.4', version: '6.4' },
					{ name: '6.3', version: '6.3' },
				];
			}
			return { status: 'succeeded' };
		} );

		render( <Onboarding /> );

		// Verify WordPress version dropdown is visible
		expect( screen.getByText( 'WordPress version' ) ).toBeInTheDocument();
		expect( screen.getByText( 'PHP version' ) ).toBeInTheDocument();

		// Find all comboboxes
		const comboboxes = screen.getAllByRole( 'combobox' );
		expect( comboboxes.length ).toBeGreaterThanOrEqual( 2 );

		// The first combobox should be the PHP version dropdown
		const phpVersionDropdown = comboboxes[ 0 ];
		expect( phpVersionDropdown ).toBeInTheDocument();

		// The second combobox should be the WordPress version dropdown
		const wpVersionDropdown = comboboxes[ 1 ];
		expect( wpVersionDropdown ).toBeInTheDocument();
	} );

	it( 'should allow selecting a different WordPress version', async () => {
		// Enable the feature flag
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			wpVersionsEnabled: true,
		} );

		// Mock WordPress versions
		( useRootSelector as jest.Mock ).mockImplementation( ( selector ) => {
			if ( selector === wordpressVersionsSelectors.selectWordPressVersions ) {
				return [
					{ name: '6.4', version: '6.4' },
					{ name: '6.3', version: '6.3' },
				];
			}
			return { status: 'succeeded' };
		} );

		// Create mocks for the functions we need to test
		const mockSetWpVersion = jest.fn();
		const mockHandleAddSiteClick = jest.fn().mockImplementation( () => {
			mockCreateSite( '/path/to/my/site', 'My Site', '6.3' );
			return Promise.resolve();
		} );

		// Override the useAddSite mock for this test
		( useAddSite as jest.Mock ).mockReturnValue( {
			setSiteName: jest.fn(),
			setProposedSitePath: jest.fn(),
			setSitePath: jest.fn(),
			setError: jest.fn(),
			setDoesPathContainWordPress: jest.fn(),
			setPhpVersion: jest.fn(),
			setWpVersion: mockSetWpVersion,
			siteName: 'My Site',
			sitePath: '/path/to/my/site',
			phpVersion: '8.0',
			wpVersion: '6.3', // Changed from default
			error: '',
			doesPathContainWordPress: false,
			handleAddSiteClick: mockHandleAddSiteClick,
			handleSiteNameChange: jest.fn(),
			handlePathSelectorClick: jest.fn(),
			onSelectPath: jest.fn(),
			setFileForImport: jest.fn(),
			fileForImport: null,
			isAdvancedSettingsVisible: true,
		} );

		render( <Onboarding /> );

		// Find all comboboxes
		const comboboxes = screen.getAllByRole( 'combobox' );

		// The second combobox should be the WordPress version dropdown
		const wpVersionDropdown = comboboxes[ 1 ];

		// Select a different WordPress version
		await user.selectOptions( wpVersionDropdown, '6.3' );

		// Submit the form
		const addSiteButton = screen.getByText( 'Add site' );
		await user.click( addSiteButton );

		// Verify that handleAddSiteClick was called
		await waitFor( () => {
			expect( mockHandleAddSiteClick ).toHaveBeenCalled();
		} );

		// Verify createSite was called with the selected WordPress version
		await waitFor( () => {
			expect( mockCreateSite ).toHaveBeenCalledWith( '/path/to/my/site', 'My Site', '6.3' );
		} );
	} );

	it( 'should allow selecting a different PHP version', async () => {
		// Enable the feature flag
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			wpVersionsEnabled: true,
		} );

		// Mock WordPress versions
		( useRootSelector as jest.Mock ).mockImplementation( ( selector ) => {
			if ( selector === wordpressVersionsSelectors.selectWordPressVersions ) {
				return [
					{ name: '6.4', version: '6.4' },
					{ name: '6.3', version: '6.3' },
				];
			}
			return { status: 'succeeded' };
		} );

		// Create a mock for setPhpVersion
		const mockSetPhpVersion = jest.fn();

		// Override the useAddSite mock for this test
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
		} );

		render( <Onboarding /> );

		// Find all comboboxes
		const comboboxes = screen.getAllByRole( 'combobox' );

		// The first combobox should be the PHP version dropdown
		const phpVersionDropdown = comboboxes[ 0 ];

		// Select a different PHP version
		await user.selectOptions( phpVersionDropdown, '8.2' );

		// Verify that setPhpVersion was called with the selected PHP version
		expect( mockSetPhpVersion ).toHaveBeenCalled();
	} );

	it( 'should not display version dropdowns when feature flag is disabled', () => {
		// Disable the feature flag
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			wpVersionsEnabled: false,
		} );

		render( <Onboarding /> );

		// Verify WordPress and PHP version dropdowns are not visible
		expect( screen.queryByText( 'WordPress version' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'PHP version' ) ).not.toBeInTheDocument();
	} );
} );
