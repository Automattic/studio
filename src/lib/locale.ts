import { app } from 'electron';
import { match } from '@formatjs/intl-localematcher';
import { loadUserData } from '../storage/user-data';
import { isSupportedLocale, SupportedLocale, supportedLocales } from './supported-locales';

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
