import { app } from 'electron';
import { match } from '@formatjs/intl-localematcher';
import * as Sentry from '@sentry/electron/main';
import type { LocaleData } from '@wordpress/i18n';

export const DEFAULT_LOCALE = 'en';

export const namedLocales = {
	ar: 'العربية',
	de: 'Deutsch',
	en: 'English',
	es: 'Español',
	fr: 'Français',
	he: 'עברית',
	id: 'Bahasa Indonesia',
	it: 'Italiano',
	ja: '日本語',
	ko: '한국어',
	nl: 'Nederlands',
	pl: 'Polski',
	'pt-br': 'Português (Brasil)',
	ru: 'Русский',
	sv: 'Svenska',
	tr: 'Türkçe',
	'zh-cn': '简体中文',
	'zh-tw': '繁體中文',
};

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
	'pl',
	'pt-br',
	'ru',
	'sv',
	'tr',
	'zh-cn',
	'zh-tw',
];

export function getSupportedLocale(): string {
	// `app.getLocale` returns the current application locale, acquired using
	// Chromium's `l10n_util` library. This value is utilized to determine
	// the best fit for supported locales.
	return match( [ app.getLocale() ], supportedLocales, DEFAULT_LOCALE );
}

export function getLocaleData( locale: string ): LocaleData | null {
	if ( locale === DEFAULT_LOCALE || ! supportedLocales.includes( locale ) ) {
		return null;
	}

	try {
		return require( `../translations/studio-${ locale }.jed.json` );
	} catch ( err ) {
		console.error( `Failed to load locale data for "${ locale }"`, err );
		Sentry.captureException( err );
		return null;
	}
}
