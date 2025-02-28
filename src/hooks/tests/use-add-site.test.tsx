// Run tests: yarn test -- src/hooks/tests/use-add-site.test.tsx
import { renderHook, act } from '@testing-library/react';
import { useAddSite } from 'src/hooks/use-add-site';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { DEFAULT_PHP_VERSION, DEFAULT_WORDPRESS_VERSION } from 'vendor/wp-now/src/constants';

// Mock dependencies
jest.mock( 'src/hooks/use-site-details' );
jest.mock( 'src/hooks/use-feature-flags' );
jest.mock( 'src/hooks/use-import-export', () => ( {
	useImportExport: () => ( {
		importFile: jest.fn(),
		clearImportState: jest.fn(),
	} ),
} ) );

jest.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		generateProposedSitePath: jest.fn().mockResolvedValue( {
			path: '/default/path',
			name: 'Default Site',
			isEmpty: true,
			isWordPress: false,
		} ),
		showNotification: jest.fn(),
	} ),
} ) );

describe( 'useAddSite', () => {
	const mockCreateSite = jest.fn();
	const mockUpdateSite = jest.fn();
	const mockStartServer = jest.fn();

	beforeEach( () => {
		jest.clearAllMocks();

		( useSiteDetails as jest.Mock ).mockReturnValue( {
			createSite: mockCreateSite,
			updateSite: mockUpdateSite,
			data: [],
			loadingSites: false,
			startServer: mockStartServer,
		} );

		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			wpVersionsEnabled: true,
		} );
	} );

	it( 'should initialize with default WordPress version', () => {
		const { result } = renderHook( () => useAddSite() );

		expect( result.current.wpVersion ).toBe( DEFAULT_WORDPRESS_VERSION );
	} );

	it( 'should initialize with default PHP version', () => {
		const { result } = renderHook( () => useAddSite() );

		expect( result.current.phpVersion ).toBe( DEFAULT_PHP_VERSION );
	} );

	it( 'should update WordPress version when setWpVersion is called', () => {
		const { result } = renderHook( () => useAddSite() );

		act( () => {
			result.current.setWpVersion( '6.1.7' );
		} );

		expect( result.current.wpVersion ).toBe( '6.1.7' );
	} );

	it( 'should update PHP version when setPhpVersion is called', () => {
		const { result } = renderHook( () => useAddSite() );

		act( () => {
			result.current.setPhpVersion( '8.2' );
		} );

		expect( result.current.phpVersion ).toBe( '8.2' );
	} );

	it( 'should pass WordPress version to createSite when handleAddSiteClick is called', async () => {
		mockCreateSite.mockImplementation( ( path, name, wpVersion, callback ) => {
			callback( {
				id: 'test-id',
				name: name || 'Test Site',
				path: path,
				wpVersion: wpVersion,
				phpVersion: '8.2',
			} );
			return Promise.resolve();
		} );

		const { result } = renderHook( () => useAddSite() );

		// Set WordPress version and site path
		act( () => {
			result.current.setWpVersion( '6.1.7' );
			result.current.setSitePath( '/test/path' );
		} );

		// Call handleAddSiteClick
		await act( async () => {
			await result.current.handleAddSiteClick();
		} );

		// Verify createSite was called with the correct WordPress version
		expect( mockCreateSite ).toHaveBeenCalledWith(
			'/test/path',
			'',
			'6.1.7',
			expect.any( Function )
		);
	} );

	it( 'should update site with WordPress version after creation', async () => {
		const newSite = {
			id: 'test-id',
			name: 'Test Site',
			path: '/test/path',
			wpVersion: '6.2.0',
			phpVersion: '8.2',
		};

		mockCreateSite.mockImplementation( ( path, name, wpVersion, callback ) => {
			callback( newSite );
			return Promise.resolve();
		} );

		const { result } = renderHook( () => useAddSite() );

		// Set WordPress version and site path
		act( () => {
			result.current.setWpVersion( '6.1.7' );
			result.current.setSitePath( '/test/path' );
		} );

		// Call handleAddSiteClick
		await act( async () => {
			await result.current.handleAddSiteClick();
		} );

		// Verify updateSite was called with the correct WordPress version
		expect( mockUpdateSite ).toHaveBeenCalledWith( {
			...newSite,
			wpVersion: '6.1.7',
		} );
	} );

	it( 'should still call updateSite even if wpVersion matches due to object comparison', async () => {
		// In this test, we'll set the wpVersion to match what's returned from createSite
		const wpVersion = '6.1.7';
		const newSite = {
			id: 'test-id',
			name: 'Test Site',
			path: '/test/path',
			wpVersion: wpVersion, // Same as what we'll set in the hook
			phpVersion: '8.2',
		};

		mockCreateSite.mockImplementation( ( path, name, version, callback ) => {
			// Return a site with the same wpVersion that was passed to createSite
			callback( {
				...newSite,
				wpVersion: version,
			} );
			return Promise.resolve();
		} );

		const { result } = renderHook( () => useAddSite() );

		// Set WordPress version to match the one in the new site
		act( () => {
			result.current.setWpVersion( wpVersion );
			result.current.setSitePath( '/test/path' );
		} );

		// Reset the mock to ensure we can check if it was called
		mockUpdateSite.mockClear();

		// Call handleAddSiteClick
		await act( async () => {
			await result.current.handleAddSiteClick();
		} );

		// In the actual implementation, updateSite is still called because the object comparison
		// (updatedSite !== newSite) will always be true for objects with the same values
		// This is a limitation of the current implementation
		expect( mockUpdateSite ).toHaveBeenCalled();

		// Verify it was called with the correct parameters
		expect( mockUpdateSite ).toHaveBeenCalledWith( {
			...newSite,
			wpVersion,
		} );
	} );

	it( 'should use DEFAULT_WORDPRESS_VERSION when feature flag is disabled', async () => {
		// Disable the feature flag
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			wpVersionsEnabled: false,
		} );

		mockCreateSite.mockImplementation( ( path, name, wpVersion, callback ) => {
			callback( {
				id: 'test-id',
				name: name || 'Test Site',
				path: path,
				wpVersion: wpVersion,
				phpVersion: '8.2',
			} );
			return Promise.resolve();
		} );

		const { result } = renderHook( () => useAddSite() );

		// Set WordPress version and site path
		act( () => {
			result.current.setWpVersion( '6.1.7' ); // This should be ignored
			result.current.setSitePath( '/test/path' );
		} );

		// Call handleAddSiteClick
		await act( async () => {
			await result.current.handleAddSiteClick();
		} );

		// Verify createSite was called with the default WordPress version
		expect( mockCreateSite ).toHaveBeenCalledWith(
			'/test/path',
			'',
			DEFAULT_WORDPRESS_VERSION,
			expect.any( Function )
		);
	} );
} );
