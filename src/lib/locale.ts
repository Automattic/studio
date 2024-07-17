import { app } from 'electron';
import { match } from '@formatjs/intl-localematcher';
import * as Sentry from '@sentry/electron/main';
import type { LocaleData } from '@wordpress/i18n';

export const DEFAULT_LOCALE = 'en';

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
	'vi',
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
