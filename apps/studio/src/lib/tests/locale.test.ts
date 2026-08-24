/**
 * @vitest-environment node
 */
import { app } from 'electron';
import { getLocaleData } from '@studio/common/lib/locale';
import * as sharedConfig from '@studio/common/lib/shared-config';
import { createI18n } from '@wordpress/i18n';
import { vi } from 'vitest';
import { getSupportedLocale, getUserLocaleWithFallback } from 'src/lib/locale-node';

vi.mocked( app ).getLocale = vi.fn();
vi.mock( '@studio/common/lib/shared-config' );

function mockAppLocale( language: string ) {
	vi.mocked( app.getLocale ).mockReturnValue( language );
}

describe( 'getSupportedLocale', () => {
	it( 'converts a language-region pair to a glotpress locale slug', () => {
		mockAppLocale( 'en-US' );

		expect( getSupportedLocale() ).toBe( 'en' );
	} );

	it( 'returns English if app locale is unsupported', () => {
		mockAppLocale( 'mi-NZ' );

		expect( getSupportedLocale() ).toBe( 'en' );
	} );

	it( 'returns zh-cn variant', () => {
		mockAppLocale( 'zh-cn' );

		expect( getSupportedLocale() ).toBe( 'zh-cn' );
	} );

	it( 'returns zh-tw variant', () => {
		mockAppLocale( 'zh-tw' );

		expect( getSupportedLocale() ).toBe( 'zh-tw' );
	} );

	it( 'returns the Simplified Chinese zh-cn option when the user preference is zh-Hans', () => {
		mockAppLocale( 'zh-Hans' );
		expect( getSupportedLocale() ).toBe( 'zh-cn' );
	} );

	it( 'returns the Traditional Chinese zh-tw option when the user preference is zh-Hant', () => {
		mockAppLocale( 'zh-Hant' );
		expect( getSupportedLocale() ).toBe( 'zh-tw' );
	} );
} );

describe( 'getUserLocaleWithFallback', () => {
	beforeEach( () => {
		vi.mocked( sharedConfig.updateSharedConfig ).mockResolvedValue( undefined );
	} );

	it( 'returns the locale from shared config when set', async () => {
		vi.mocked( sharedConfig.readSharedConfig ).mockResolvedValue( {
			version: 1,
			locale: 'ja',
		} );
		mockAppLocale( 'en-US' );

		await expect( getUserLocaleWithFallback() ).resolves.toBe( 'ja' );
		expect( sharedConfig.updateSharedConfig ).not.toHaveBeenCalled();
	} );

	it( 'detects the system locale and persists it when shared config has no locale', async () => {
		vi.mocked( sharedConfig.readSharedConfig ).mockResolvedValue( {
			version: 1,
		} );
		mockAppLocale( 'ja' );

		await expect( getUserLocaleWithFallback() ).resolves.toBe( 'ja' );
		expect( sharedConfig.updateSharedConfig ).toHaveBeenCalledWith( { locale: 'ja' } );
	} );

	it( 'detects and persists when shared config cannot be read', async () => {
		vi.mocked( sharedConfig.readSharedConfig ).mockRejectedValue( new Error( 'unreadable' ) );
		mockAppLocale( 'fr' );

		await expect( getUserLocaleWithFallback() ).resolves.toBe( 'fr' );
		expect( sharedConfig.updateSharedConfig ).toHaveBeenCalledWith( { locale: 'fr' } );
	} );
} );

describe( 'getLocaleData', () => {
	it( 'returns null for unsupported locales', async () => {
		const localeData = getLocaleData( 'mi-NZ' );
		expect( localeData ).toBeNull();
	} );

	it( 'returns null for English', async () => {
		const localeData = getLocaleData( 'en' );
		expect( localeData ).toBeNull();
	} );

	it( 'returns locale data for supported locales', async () => {
		const localeData = getLocaleData( 'ar' );
		expect( localeData ).not.toBeNull();

		// Do some translating with the loaded data
		const i18n = createI18n( localeData?.messages );
		expect( i18n._x( 'ltr', 'text direction' ) ).toBe( 'rtl' );
	} );
} );
