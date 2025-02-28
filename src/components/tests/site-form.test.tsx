import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { SiteForm } from 'src/components/site-form';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { wordpressVersionsSelectors } from 'src/stores/wordpress-versions-slice';
import { DEFAULT_WORDPRESS_VERSION } from 'vendor/wp-now/src/constants';

// Mock the feature flags hook
jest.mock( 'src/hooks/use-feature-flags' );

// Mock the Redux store hooks
jest.mock( 'src/stores', () => ( {
	useAppDispatch: jest.fn(),
	useRootSelector: jest.fn(),
} ) );

// Mock the docs link hook
jest.mock( 'src/hooks/use-docs-link', () => ( {
	useDocsLink: () => jest.fn().mockReturnValue( 'https://example.com' ),
} ) );

describe( 'SiteForm', () => {
	const mockSetSiteName = jest.fn();
	const mockSetPhpVersion = jest.fn();
	const mockSetWpVersion = jest.fn();
	const mockOnSubmit = jest.fn();
	const mockOnSelectPath = jest.fn();
	const mockDispatch = jest.fn();
	const mockSetFileForImport = jest.fn();
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
	} );

	it( 'should render basic form elements', () => {
		render(
			<SiteForm
				siteName="Test Site"
				setSiteName={ mockSetSiteName }
				error=""
				onSubmit={ mockOnSubmit }
			/>
		);

		// Verify basic form elements are rendered
		expect( screen.getByLabelText( 'Site name' ) ).toBeInTheDocument();
		expect( screen.getByDisplayValue( 'Test Site' ) ).toBeInTheDocument();
	} );

	it( 'should not render WordPress version dropdown when feature flag is disabled', () => {
		render(
			<SiteForm
				siteName="Test Site"
				setSiteName={ mockSetSiteName }
				phpVersion="8.0"
				setPhpVersion={ mockSetPhpVersion }
				wpVersion={ DEFAULT_WORDPRESS_VERSION }
				setWpVersion={ mockSetWpVersion }
				error=""
				onSubmit={ mockOnSubmit }
				allowVersionsChange={ true }
			/>
		);

		// WordPress version dropdown should not be visible
		expect( screen.queryByText( 'WordPress version' ) ).not.toBeInTheDocument();
	} );

	it( 'should render WordPress version dropdown when feature flag is enabled', async () => {
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

		render(
			<SiteForm
				siteName="Test Site"
				setSiteName={ mockSetSiteName }
				phpVersion="8.0"
				setPhpVersion={ mockSetPhpVersion }
				wpVersion={ DEFAULT_WORDPRESS_VERSION }
				setWpVersion={ mockSetWpVersion }
				error=""
				onSubmit={ mockOnSubmit }
				allowVersionsChange={ true }
				sitePath="/path/to/site"
				onSelectPath={ mockOnSelectPath }
				setFileForImport={ mockSetFileForImport }
				fileForImport={ null }
			/>
		);

		// Open advanced settings to see the WordPress version dropdown
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );

		// WordPress version dropdown should be visible
		expect( screen.getByText( 'WordPress version' ) ).toBeInTheDocument();
	} );

	it( 'should call setWpVersion when a different version is selected', async () => {
		// Enable the feature flag
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			wpVersionsEnabled: true,
		} );

		// Mock WordPress versions
		( useRootSelector as jest.Mock ).mockImplementation( ( selector ) => {
			if ( selector === wordpressVersionsSelectors.selectWordPressVersions ) {
				return [
					{ name: '6.1.7', version: '6.1.7' },
					{ name: DEFAULT_WORDPRESS_VERSION, version: DEFAULT_WORDPRESS_VERSION },
				];
			}
			return { status: 'succeeded' };
		} );

		render(
			<SiteForm
				siteName="Test Site"
				setSiteName={ mockSetSiteName }
				phpVersion="8.0"
				setPhpVersion={ mockSetPhpVersion }
				wpVersion={ DEFAULT_WORDPRESS_VERSION }
				setWpVersion={ mockSetWpVersion }
				error=""
				onSubmit={ mockOnSubmit }
				allowVersionsChange={ true }
				sitePath="/path/to/site"
				onSelectPath={ mockOnSelectPath }
				setFileForImport={ mockSetFileForImport }
				fileForImport={ null }
			/>
		);

		// Open advanced settings to see the WordPress version dropdown
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );

		// Find the WordPress version section
		const wpVersionLabel = screen.getByText( 'WordPress version' );
		const wpVersionSection = wpVersionLabel.closest( 'div' );

		// Find the select element within the WordPress version section
		const selectElement = within( wpVersionSection as HTMLElement ).getByRole( 'combobox' );

		// Select a different WordPress version
		await user.selectOptions( selectElement, '6.1.7' );

		// Verify setWpVersion was called with the selected version
		expect( mockSetWpVersion ).toHaveBeenCalledWith( '6.1.7' );
	} );

	it( 'should call setPhpVersion when a different PHP version is selected', async () => {
		// Enable the feature flag
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			wpVersionsEnabled: true,
		} );

		render(
			<SiteForm
				siteName="Test Site"
				setSiteName={ mockSetSiteName }
				phpVersion="8.0"
				setPhpVersion={ mockSetPhpVersion }
				wpVersion={ DEFAULT_WORDPRESS_VERSION }
				setWpVersion={ mockSetWpVersion }
				error=""
				onSubmit={ mockOnSubmit }
				allowVersionsChange={ true }
				sitePath="/path/to/site"
				onSelectPath={ mockOnSelectPath }
				setFileForImport={ mockSetFileForImport }
				fileForImport={ null }
			/>
		);

		// Open advanced settings to see the PHP version dropdown
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );

		// Find the PHP version section
		const phpVersionLabel = screen.getByText( 'PHP version' );
		const phpVersionSection = phpVersionLabel.closest( 'div' );

		// Find the select element within the PHP version section
		const selectElement = within( phpVersionSection as HTMLElement ).getByRole( 'combobox' );

		// Select a different PHP version
		await user.selectOptions( selectElement, '8.2' );

		// Verify setPhpVersion was called with the selected version
		expect( mockSetPhpVersion ).toHaveBeenCalledWith( '8.2' );
	} );

	it( 'should not display PHP version dropdown when feature flag is disabled', async () => {
		// Disable the feature flag
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			wpVersionsEnabled: false,
		} );

		render(
			<SiteForm
				siteName="Test Site"
				setSiteName={ mockSetSiteName }
				phpVersion="8.0"
				setPhpVersion={ mockSetPhpVersion }
				wpVersion={ DEFAULT_WORDPRESS_VERSION }
				setWpVersion={ mockSetWpVersion }
				error=""
				onSubmit={ mockOnSubmit }
				allowVersionsChange={ true }
				sitePath="/path/to/site"
				onSelectPath={ mockOnSelectPath }
				setFileForImport={ mockSetFileForImport }
				fileForImport={ null }
			/>
		);

		// Open advanced settings
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );

		// PHP version dropdown should not be visible
		expect( screen.queryByText( 'PHP version' ) ).not.toBeInTheDocument();
	} );

	it( 'should not render WordPress version dropdown when allowVersionsChange is false', () => {
		// Enable the feature flag
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			wpVersionsEnabled: true,
		} );

		render(
			<SiteForm
				siteName="Test Site"
				setSiteName={ mockSetSiteName }
				error=""
				onSubmit={ mockOnSubmit }
				allowVersionsChange={ false }
			/>
		);

		// WordPress version dropdown should not be visible
		expect( screen.queryByText( 'WordPress version' ) ).not.toBeInTheDocument();
	} );
} );
