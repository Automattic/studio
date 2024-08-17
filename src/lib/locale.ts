import { app } from 'electron';
import { match } from '@formatjs/intl-localematcher';
import { loadUserData } from '../storage/user-data';
import { localeDataDictionary } from '../translations';
import { isSupportedLocale, SupportedLocale, supportedLocales } from './supported-locales';
import type { LocaleData } from '@wordpress/i18n';

export const DEFAULT_LOCALE = 'en';

export function getSupportedLocale() {
	// `app.getLocale` returns the current application locale, acquired using
	// Chromium's `l10n_util` library. This value is utilized to determine
	// the best fit for supported locales.
	return match( [ app.getLocale() ], supportedLocales, DEFAULT_LOCALE ) as SupportedLocale;
}

export async function getUserLocaleWithFallback() {
	const { locale } = await loadUserData();
	if ( ! locale || ! isSupportedLocale( locale ) ) {
		return getSupportedLocale();
	}
	return locale;
}

function isLocaleSupported( locale: string ): locale is keyof typeof localeDataDictionary {
	return locale in localeDataDictionary;
}

export function getLocaleData( locale: string ): LocaleData | null {
	if ( locale === DEFAULT_LOCALE || ! isLocaleSupported( locale ) ) {
		return null;
	}

	return localeDataDictionary[ locale ];
}
