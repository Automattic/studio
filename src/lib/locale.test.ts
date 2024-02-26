import { app } from 'electron';
import { createI18n } from '@wordpress/i18n';
import { getLocaleData, getSupportedLocale } from './locale';

jest.mock( 'electron', () => ( {
	app: {
		getPreferredSystemLanguages: jest.fn().mockReturnValue( [ 'en-US' ] ),
	},
} ) );

function mockPreferredLanguages( languages: string[] ) {
	( app.getPreferredSystemLanguages as jest.Mock ).mockReturnValue( languages );
}

describe( 'getSupportedLocale', () => {
	it( 'converts a language-region pair to a glotpress locale slug', () => {
		mockPreferredLanguages( [ 'en-US' ] );

		expect( getSupportedLocale() ).toBe( 'en' );
	} );

	it( 'returns English if preferred language is unsupported', () => {
		mockPreferredLanguages( [ 'mi-NZ' ] );

		expect( getSupportedLocale() ).toBe( 'en' );
	} );

	it( "falls back to lesser preferred languages if the most preferred isn't supported", () => {
		mockPreferredLanguages( [ 'mi-NZ', 'fr-FR', 'en-US' ] );

		expect( getSupportedLocale() ).toBe( 'fr' );
	} );

	it( 'ignores region if the best match is a matching language with a different region', () => {
		mockPreferredLanguages( [ 'mi-NZ', 'pt-PT' ] );

		expect( getSupportedLocale() ).toBe( 'pt-br' );
	} );

	it( "prefers an exact language-region match, even if it's lower in the preference order", () => {
		mockPreferredLanguages( [ 'mi-NZ', 'pt-PT', 'zh-CN' ] );

		expect( getSupportedLocale() ).toBe( 'zh-cn' );
	} );

	it( 'returns zh-cn variant', () => {
		mockPreferredLanguages( [ 'zh-cn', 'zh-tw' ] );

		expect( getSupportedLocale() ).toBe( 'zh-cn' );
	} );

	it( 'returns zh-tw variant', () => {
		mockPreferredLanguages( [ 'zh-tw', 'zh-cn' ] );

		expect( getSupportedLocale() ).toBe( 'zh-tw' );
	} );

	it( "prefers a language with a different region over an exact language _and_ region match which is further down the user's preference list", () => {
		mockPreferredLanguages( [ 'fr-PL', 'pt-BR' ] );
		expect( getSupportedLocale() ).toBe( 'fr' );
	} );

	it( 'returns the Simplified Chinese zh-cn option when the user preference is zh-Hans', () => {
		mockPreferredLanguages( [ 'zh-NZ', 'zh-Hans' ] );
		expect( getSupportedLocale() ).toBe( 'zh-cn' );
	} );

	it( 'returns the Traditional Chinese zh-tw option when the user preference is zh-Hant', () => {
		mockPreferredLanguages( [ 'zh-Hant' ] );
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
		const i18n = createI18n( localeData?.locale_data?.messages );
		expect( i18n._x( 'ltr', 'text direction' ) ).toBe( 'rtl' );
	} );
} );
