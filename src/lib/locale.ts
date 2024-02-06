import { app } from 'electron';
import type { LocaleData } from '@wordpress/i18n';

const supportedLocales = [
	'ar',
	'de',
	'en',
	'es',
	'fr',
	'he',
	'id',
	'it',
	'ja',
	'ko',
	'nl',
	'pt-br',
	'ru',
	'sv',
	'tr',
	'zh-cn',
	'zh-tw',
];

export function getSupportedLocale(): string {
	const preferredLanguages = app.getPreferredSystemLanguages();

	// Look for exact matches (ignoring case)
	for ( const language of preferredLanguages ) {
		const locale = language.toLowerCase();

		if ( supportedLocales.includes( locale ) ) {
			return locale;
		}
	}

	// Look for language-only matches
	for ( const language of preferredLanguages ) {
		const locale = language.toLowerCase().split( '-' )[ 0 ];

		for ( const supportedLocale of supportedLocales ) {
			if ( supportedLocale.startsWith( locale ) ) {
				return supportedLocale;
			}
		}
	}

	return 'en';
}

export async function getLocaleData( locale: string ): Promise< LocaleData | null > {
	if ( locale === 'en' || ! supportedLocales.includes( locale ) ) {
		return null;
	}

	try {
		return await import( `../translations/local-environment-${ locale }.jed.json` );
	} catch ( err ) {
		console.error( `Failed to load locale data for "${ locale }"`, err );
		return null;
	}
}
