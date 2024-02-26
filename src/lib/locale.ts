import { app } from 'electron';
import { match } from '@formatjs/intl-localematcher';
import * as Sentry from '@sentry/electron/main';
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
	if ( process.platform === 'linux' && process.env.NODE_ENV !== 'test' ) {
		// app.getPreferredSystemLanguages() is implemented by g_get_language_names on Linux.
		// See: https://developer-old.gnome.org/glib/unstable/glib-I18N.html#g-get-language-names
		// The language tags returned by this system function are in a format like "en_US" or "en_US.utf8".
		// When these sorts of tags are passed to Intl.getCanonicalLocales() it throws an error.
		return 'en';
	}

	const preferredLanguages = app.getPreferredSystemLanguages();
	return match( preferredLanguages, supportedLocales, 'en' );
}

export function getLocaleData( locale: string ): LocaleData | null {
	if ( locale === 'en' || ! supportedLocales.includes( locale ) ) {
		return null;
	}

	try {
		return require( `../translations/local-environment-${ locale }.jed.json` );
	} catch ( err ) {
		console.error( `Failed to load locale data for "${ locale }"`, err );
		Sentry.captureException( err );
		return null;
	}
}
