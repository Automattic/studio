/**
 * @vitest-environment node
 */
import { vi, beforeEach } from 'vitest';
import { getPreferredSiteLanguage } from 'src/lib/site-language';
import * as storagePaths from 'src/storage/paths';

vi.mock( 'electron', () => ( {
	app: {
		getLocale: vi.fn(),
	},
} ) );

vi.spyOn( storagePaths, 'getResourcesPath' ).mockReturnValue( process.cwd() );

// `getPreferredSiteLanguage` uses `getUserLocaleWithFallback`, which calls `loadUserData` to
// get the user's locale. This mock ensures that `loadUserData` returns an empty object, which
// simulates a user with no locale preference.
vi.mock( 'src/storage/user-data', () => ( {
	loadUserData: vi.fn().mockResolvedValue( { locale: undefined } ),
} ) );

// Store original fetch to restore later
const originalFetch = global.fetch;

async function mockAppLocale( language: string ) {
	const { app } = await import( 'electron' );
	vi.mocked( app.getLocale ).mockReturnValue( language );
}

function mockFetchTranslations( wpVersion: string, locales: string[] ) {
	const data = {
		translations: locales.map( ( locale ) => {
			// WordPress API returns language codes with underscores, not hyphens
			const language = locale.split( '-' ).join( '_' );
			return {
				language,
				english_name: `Language ${ locale }`,
				native_name: `Language ${ locale }`,
			};
		} ),
	};

	// Mock fetch to return our test data
	global.fetch = vi.fn().mockImplementation( ( url: string ) => {
		const expectedUrl =
			wpVersion === 'latest'
				? 'https://api.wordpress.org/translations/core/1.0/'
				: `https://api.wordpress.org/translations/core/1.0/?version=${ wpVersion }`;

		if ( url === expectedUrl ) {
			return Promise.resolve( {
				ok: true,
				json: () => Promise.resolve( data ),
			} as Response );
		}

		// Fall back to original fetch for other URLs
		return originalFetch( url );
	} );
}

describe( 'getPreferredSiteLanguage', () => {
	let consoleErrorSpy: ReturnType< typeof vi.spyOn >;

	beforeEach( () => {
		// Restore original fetch before each test
		global.fetch = originalFetch;
		// Suppress console.error calls during tests
		consoleErrorSpy = vi.spyOn( console, 'error' ).mockImplementation( ( ...args ) => {
			// Let console.log through for debugging
			if ( args[ 0 ]?.includes?.( 'FAILED' ) ) {
				console.log( ...args );
			}
		} );
	} );

	afterEach( () => {
		consoleErrorSpy.mockRestore();
		// Restore original fetch after each test
		global.fetch = originalFetch;
	} );

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
			await mockAppLocale( 'mi-NZ' );

			expect( await getPreferredSiteLanguage() ).toBe( 'en' );
		} );

		it.each( LATEST_WP_VERSION_LOCALES )(
			"returns '$expected' for language '$locale'",
			async ( { locale, expected }: { locale: string; expected: string } ) => {
				const AVAILABLE_LOCALES = LATEST_WP_VERSION_LOCALES.map( ( l ) =>
					l.expected.replace( '_', '-' )
				);
				mockFetchTranslations( 'latest', AVAILABLE_LOCALES );
				await mockAppLocale( locale );

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
			async ( { locale, expected }: { locale: string; expected: string } ) => {
				await mockAppLocale( locale );
				mockFetchTranslations( WP_VERSION, AVAILABLE_LOCALES );

				const result = await getPreferredSiteLanguage( WP_VERSION );
				expect( result ).toBe( expected );
			}
		);

		it( "returns 'en' when there are no translations", async () => {
			await mockAppLocale( WP_5_0_LOCALES[ 0 ].locale );
			// Mock fetch to throw an error
			global.fetch = vi.fn().mockRejectedValue( new Error( 'Not found' ) );

			expect( await getPreferredSiteLanguage( WP_VERSION ) ).toBe( 'en' );

			// The error could be from reading the file or fetching from API
			expect( consoleErrorSpy ).toHaveBeenCalled();
			expect( consoleErrorSpy.mock.calls[ 0 ][ 0 ] ).toMatch( /An error ocurred/ );
		} );
	} );
} );
