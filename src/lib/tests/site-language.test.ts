import { app } from 'electron';
import { getPreferredSiteLanguage } from '../site-language';

jest.mock( 'electron', () => ( {
	app: {
		getPreferredSystemLanguages: jest.fn().mockReturnValue( [ 'en' ] ),
	},
} ) );

const originalFetch = global.fetch;

function mockPreferredLanguages( languages: string[] ) {
	( app.getPreferredSystemLanguages as jest.Mock ).mockReturnValue( languages );
}

function mockFetchTranslations( wpVersion: string, translations: string[] ) {
	const data = {
		translations: translations.map( ( item ) => ( { language: item } ) ),
	};
	global.fetch = jest.fn( ( url ): Promise< Response > => {
		const expectedURL =
			wpVersion === 'latest'
				? 'https://api.wordpress.org/translations/core/1.0/'
				: `https://api.wordpress.org/translations/core/1.0/?version=${ wpVersion }`;
		if ( url === expectedURL ) {
			return Promise.resolve( {
				json: () => Promise.resolve( data ),
			} as Response );
		} else {
			return Promise.reject();
		}
	} );
}

afterAll( () => {
	global.fetch = originalFetch;
} );

describe( 'getPreferredSiteLanguage', () => {
	describe( 'latest WP version', () => {
		const LATEST_WP_VERSION_LOCALES = [
			{ locale: 'en', expected: 'en' },
			{ locale: 'en-US', expected: 'en' },
			{ locale: 'es-ES', expected: 'es_ES' },
			{ locale: 'es-419', expected: 'es_CO' },
			{ locale: 'es-SV', expected: 'es_CO' },
			{ locale: 'ca-ES', expected: 'ca' },
			{ locale: 'en-ES', expected: 'en_GB' },
			{ locale: 'en-IE', expected: 'en_GB' },
			{ locale: 'de', expected: 'de_DE' },
			{ locale: 'de-DE-x-formal', expected: 'de_DE' },
			{ locale: 'gsw', expected: 'de_CH' },
			{ locale: 'it', expected: 'it_IT' },
			{ locale: 'he', expected: 'he_IL' },
			{ locale: 'fi-EN', expected: 'fi' },
			{ locale: 'ja', expected: 'ja' },
			{ locale: 'ko', expected: 'ko_KR' },
			{ locale: 'nl', expected: 'nl_NL' },
			{ locale: 'pl', expected: 'pl_PL' },
			{ locale: 'pt-BR', expected: 'pt_BR' },
			{ locale: 'ru', expected: 'ru_RU' },
			{ locale: 'sv', expected: 'sv_SE' },
			{ locale: 'tr', expected: 'tr_TR' },
			{ locale: 'zh-Hant-HK', expected: 'zh_HK' },
			{ locale: 'zh-Hans', expected: 'zh_CN' },
			{ locale: 'zh-Hant-TW', expected: 'zh_TW' },
		];

		it( "returns 'en' as default language", async () => {
			mockPreferredLanguages( [] );

			expect( await getPreferredSiteLanguage() ).toBe( 'en' );
		} );

		it.each( LATEST_WP_VERSION_LOCALES )(
			"returns '$expected' for language '$locale'",
			async ( { locale, expected } ) => {
				mockPreferredLanguages( [ locale ] );

				expect( await getPreferredSiteLanguage() ).toBe( expected );
			}
		);
	} );

	describe( 'specific WP version', () => {
		const WP_VERSION = '5.0';
		const AVAILABLE_LOCALES = [ 'en', 'en-US', 'en-GB', 'es-ES' ];
		const WP_5_0_LOCALES = [
			{ locale: 'en', expected: 'en' },
			{ locale: 'en-US', expected: 'en' },
			{ locale: 'es-ES', expected: 'es_ES' },
			{ locale: 'es-419', expected: 'es_ES' },
			{ locale: 'es-SV', expected: 'es_ES' },
			{ locale: 'ca-ES', expected: 'es_ES' },
			{ locale: 'en-ES', expected: 'en_GB' },
			{ locale: 'en-IE', expected: 'en_GB' },
			{ locale: 'de', expected: 'en' },
			{ locale: 'de-DE-x-formal', expected: 'en' },
			{ locale: 'gsw', expected: 'en' },
			{ locale: 'it', expected: 'en' },
			{ locale: 'he', expected: 'en' },
			{ locale: 'fi-EN', expected: 'en' },
			{ locale: 'ja', expected: 'en' },
			{ locale: 'ko', expected: 'en' },
			{ locale: 'nl', expected: 'en' },
			{ locale: 'pl', expected: 'en' },
			{ locale: 'pt-BR', expected: 'en' },
			{ locale: 'ru', expected: 'en' },
			{ locale: 'sv', expected: 'en' },
			{ locale: 'tr', expected: 'en' },
			{ locale: 'zh-Hant-HK', expected: 'en' },
			{ locale: 'zh-Hans', expected: 'en' },
			{ locale: 'zh-Hant-TW', expected: 'en' },
		];

		it( "returns 'en' as default language", async () => {
			mockPreferredLanguages( [] );
			mockFetchTranslations( WP_VERSION, AVAILABLE_LOCALES );

			expect( await getPreferredSiteLanguage( WP_VERSION ) ).toBe( 'en' );
		} );

		it.each( WP_5_0_LOCALES )(
			"returns '$expected' for language '$locale'",
			async ( { locale, expected } ) => {
				mockPreferredLanguages( [ locale ] );
				mockFetchTranslations( WP_VERSION, AVAILABLE_LOCALES );

				expect( await getPreferredSiteLanguage( WP_VERSION ) ).toBe( expected );
			}
		);

		it( "returns 'en' when there are no translations", async () => {
			const error = jest.spyOn( console, 'error' ).mockImplementation( () => {
				/* NOOP */
			} );

			mockPreferredLanguages( WP_5_0_LOCALES.map( ( item ) => item.locale ) );
			mockFetchTranslations( 'unknown', [] );

			expect( await getPreferredSiteLanguage( WP_VERSION ) ).toBe( 'en' );

			expect( error ).toHaveBeenCalledWith(
				"An error ocurred when fetching available site translations for version '5.0':",
				undefined
			);

			error.mockReset();
		} );
	} );
} );
