import { renderHook } from '@testing-library/react';
import { useDocsLink, getDocsLink } from '../use-docs-link';
import { useI18nData } from '../use-i18n-data';

// Mock the useI18nData hook
jest.mock( '../use-i18n-data' );
const mockUseI18nData = useI18nData as jest.MockedFunction< typeof useI18nData >;

describe( 'useDocsLink', () => {
	const mockSetLocale = jest.fn();

	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'should return English URLs when locale is en', () => {
		mockUseI18nData.mockReturnValue( { locale: 'en', setLocale: mockSetLocale } );

		const { result } = renderHook( () => useDocsLink() );

		expect( result.current( 'studio' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/'
		);
		expect( result.current( 'importExport' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/import-export/'
		);
		expect( result.current( 'sites' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/sites/'
		);
		expect( result.current( 'sync' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/sync/'
		);
	} );

	it( 'should return English URLs when locale is not in available translations', () => {
		mockUseI18nData.mockReturnValue( { locale: 'uk', setLocale: mockSetLocale } );

		const { result } = renderHook( () => useDocsLink() );

		expect( result.current( 'studio' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/'
		);
		expect( result.current( 'importExport' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/import-export/'
		);
		expect( result.current( 'sites' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/sites/'
		);
		expect( result.current( 'sync' ) ).toBe(
			'https://developer.wordpress.com/docs/developer-tools/studio/sync/'
		);
	} );

	it( 'should return Spanish URLs when locale is es', () => {
		mockUseI18nData.mockReturnValue( { locale: 'es', setLocale: mockSetLocale } );

		const { result } = renderHook( () => useDocsLink() );

		expect( result.current( 'studio' ) ).toBe(
			'https://developer.wordpress.com/es/docs/developer-tools/studio/'
		);
		expect( result.current( 'importExport' ) ).toBe(
			'https://developer.wordpress.com/es/docs/developer-tools/studio/import-export/'
		);
		expect( result.current( 'sites' ) ).toBe(
			'https://developer.wordpress.com/es/docs/developer-tools/studio/sites/'
		);
		expect( result.current( 'sync' ) ).toBe(
			'https://developer.wordpress.com/es/docs/developer-tools/studio/sync/'
		);
	} );

	describe( 'getDocsLink function used in nodejs on electron action menu', () => {
		it( 'should return English URLs when called directly with en locale', () => {
			expect( getDocsLink( 'en', 'studio' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/'
			);
			expect( getDocsLink( 'en', 'importExport' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/import-export/'
			);
			expect( getDocsLink( 'en', 'sites' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/sites/'
			);
			expect( getDocsLink( 'en', 'sync' ) ).toBe(
				'https://developer.wordpress.com/docs/developer-tools/studio/sync/'
			);
		} );

		it( 'should return Spanish URLs when called directly with es locale', () => {
			expect( getDocsLink( 'es', 'studio' ) ).toBe(
				'https://developer.wordpress.com/es/docs/developer-tools/studio/'
			);
			expect( getDocsLink( 'es', 'importExport' ) ).toBe(
				'https://developer.wordpress.com/es/docs/developer-tools/studio/import-export/'
			);
			expect( getDocsLink( 'es', 'sites' ) ).toBe(
				'https://developer.wordpress.com/es/docs/developer-tools/studio/sites/'
			);
			expect( getDocsLink( 'es', 'sync' ) ).toBe(
				'https://developer.wordpress.com/es/docs/developer-tools/studio/sync/'
			);
		} );
	} );
} );
