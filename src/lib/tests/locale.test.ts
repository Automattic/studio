/**
 * @jest-environment node
 */
import { app } from 'electron';
import { createI18n } from '@wordpress/i18n';
import { getLocaleData } from '../locale';
import { getSupportedLocale } from '../locale-node';

function mockAppLocale( language: string ) {
	( app.getLocale as jest.Mock ).mockReturnValue( language );
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
