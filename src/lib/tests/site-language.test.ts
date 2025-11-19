import { app } from 'electron';
import nock from 'nock';
import { getPreferredSiteLanguage } from 'src/lib/site-language';
import * as storagePaths from 'src/storage/paths';

jest.spyOn( storagePaths, 'getResourcesPath' ).mockReturnValue( process.cwd() );

jest.unmock( 'fs-extra' );

// `getPreferredSiteLanguage` uses `getUserLocaleWithFallback`, which calls `loadUserData` to
// get the user's locale. This mock ensures that `loadUserData` returns an empty object, which
// simulates a user with no locale preference.
jest.mock( 'src/storage/user-data', () => ( {
	loadUserData: jest.fn().mockResolvedValue( { locale: undefined } ),
} ) );

function mockAppLocale( language: string ) {
	( app.getLocale as jest.Mock ).mockReturnValue( language );
}

function mockFetchTranslations( wpVersion: string, locales: string[] ) {
	const data = {
		translations: locales.map( ( locale ) => ( { language: locale } ) ),
	};

	nock( 'https://api.wordpress.org' ).get( '/translations/core/1.0/' ).reply( 200, data );
	nock( 'https://api.wordpress.org' )
		.get( '/translations/core/1.0/' )
		.query( { version: wpVersion } )
		.reply( 200, data );
}

afterEach( () => {
	nock.cleanAll();
} );

describe( 'getPreferredSiteLanguage', () => {
	describe( 'latest WP version', () => {
		const LATEST_WP_VERSION_LOCALES = [
			{ locale: 'en', expected: 'en' },
			{ locale: 'en-US', expected: 'en' },
			{ locale: 'es-ES', expected: 'es_ES' },
			{ locale: 'ca-ES', expected: 'es_ES' },
			{ locale: 'en-ES', expected: 'en' },
			{ locale: 'en-IE', expected: 'en' },
			{ locale: 'de', expected: 'de_DE' },
			{ locale: 'de-DE-x-formal', expected: 'de_DE' },
			{ locale: 'gsw', expected: 'de_DE' },
			{ locale: 'it', expected: 'it_IT' },
			{ locale: 'he', expected: 'he_IL' },
			{ locale: 'fi-EN', expected: 'en' },
			{ locale: 'ja', expected: 'ja' },
			{ locale: 'ko', expected: 'ko_KR' },
			{ locale: 'nl', expected: 'nl_NL' },
			{ locale: 'pl', expected: 'pl_PL' },
			{ locale: 'pt-BR', expected: 'pt_BR' },
			{ locale: 'ru', expected: 'ru_RU' },
			{ locale: 'sv', expected: 'sv_SE' },
			{ locale: 'tr', expected: 'tr_TR' },
			{ locale: 'zh-Hant-HK', expected: 'zh_TW' },
			{ locale: 'zh-Hans', expected: 'zh_CN' },
			{ locale: 'zh-Hant-TW', expected: 'zh_TW' },
		];

		it( "returns 'en' as default language", async () => {
			mockAppLocale( 'mi-NZ' );

			expect( await getPreferredSiteLanguage() ).toBe( 'en' );
		} );

		it.each( LATEST_WP_VERSION_LOCALES )(
			"returns '$expected' for language '$locale'",
			async ( { locale, expected } ) => {
				const AVAILABLE_LOCALES = LATEST_WP_VERSION_LOCALES.map( ( l ) =>
					l.expected.replace( '_', '-' )
				);
				mockFetchTranslations( 'latest', AVAILABLE_LOCALES );
				mockAppLocale( locale );

				expect( await getPreferredSiteLanguage() ).toBe( expected );
			}
		);
	} );

	describe( 'WP version with fewer supported languages', () => {
		const WP_VERSION = '1.0';
		const AVAILABLE_LOCALES = [ 'en', 'en-US', 'en-GB', 'es-ES' ];
		const WP_5_0_LOCALES = [
			{ locale: 'en', expected: 'en' },
			{ locale: 'en-US', expected: 'en' },
			{ locale: 'es-ES', expected: 'es_ES' },
			{ locale: 'es-419', expected: 'es_ES' },
			{ locale: 'es-SV', expected: 'es_ES' },
			{ locale: 'ca-ES', expected: 'es_ES' },
			{ locale: 'en-ES', expected: 'en' },
			{ locale: 'en-IE', expected: 'en' },
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

		it.each( WP_5_0_LOCALES )(
			"returns '$expected' for language '$locale'",
			async ( { locale, expected } ) => {
				mockAppLocale( locale );
				mockFetchTranslations( WP_VERSION, AVAILABLE_LOCALES );

				expect( await getPreferredSiteLanguage( WP_VERSION ) ).toBe( expected );
			}
		);

		it( "returns 'en' when there are no translations", async () => {
			const error = jest.spyOn( console, 'error' ).mockImplementation( () => {
				/* NOOP */
			} );

			mockAppLocale( WP_5_0_LOCALES[ 0 ].locale );
			nock( 'https://api.wordpress.org' )
				.get( '/translations/core/1.0/' )
				.query( { version: 'unknown' } )
				.replyWithError( 'Not found' );

			expect( await getPreferredSiteLanguage( WP_VERSION ) ).toBe( 'en' );

			expect( error ).toHaveBeenCalledWith(
				"An error ocurred when fetching available site translations for version '1.0':",
				expect.any( Error )
			);

			error.mockReset();
		} );
	} );
} );
