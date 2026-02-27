import { app } from 'electron';
import { match } from '@formatjs/intl-localematcher';
import {
	DEFAULT_LOCALE,
	isSupportedLocale,
	SupportedLocale,
	supportedLocales,
} from '@studio/common/lib/locale';
import { loadUserData } from 'src/storage/user-data';

export function getSupportedLocale() {
	// `app.getLocale` returns the current application locale, acquired using
	// Chromium's `l10n_util` library. This value is utilized to determine
	// the best fit for supported locales.
	return match( [ app.getLocale() ], supportedLocales, DEFAULT_LOCALE ) as SupportedLocale;
}

export async function getUserLocaleWithFallback() {
	try {
		const { locale } = await loadUserData();
		if ( ! locale || ! isSupportedLocale( locale ) ) {
			return getSupportedLocale();
		}
		return locale;
	} catch ( error ) {
		return getSupportedLocale();
	}
}
