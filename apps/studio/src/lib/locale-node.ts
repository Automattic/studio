import { app, systemPreferences } from 'electron';
import { match } from '@formatjs/intl-localematcher';
import {
	DEFAULT_LOCALE,
	getLocaleData,
	isSupportedLocale,
	SupportedLocale,
	supportedLocales,
} from '@studio/common/lib/locale';
import { readSharedConfig } from '@studio/common/lib/shared-config';
import { defaultI18n } from '@wordpress/i18n';

export function getSupportedLocale() {
	// `app.getLocale` returns the current application locale, acquired using
	// Chromium's `l10n_util` library. This value is utilized to determine
	// the best fit for supported locales.
	const matched = match( [ app.getLocale() ], supportedLocales, DEFAULT_LOCALE );
	// `match` canonicalizes BCP-47 casing (e.g. `zh-cn` -> `zh-CN`), but our
	// supported-locale keys are lowercase
	return matched.toLowerCase() as SupportedLocale;
}

export async function getSavedLocale(): Promise< SupportedLocale | undefined > {
	try {
		const { locale } = await readSharedConfig();
		return isSupportedLocale( locale ) ? locale : undefined;
	} catch ( error ) {
		return undefined;
	}
}

export async function getUserLocaleWithFallback() {
	return ( await getSavedLocale() ) ?? getSupportedLocale();
}

// macOS translates the items it adds to the app menus itself (e.g. window tiling in the Window
// menu), in the app's AppleLanguages rather than Studio's locale. It reads it at launch, so a
// change applies from the next start.
export function setMacAppLanguage( locale: string ) {
	if ( process.platform === 'darwin' && isSupportedLocale( locale ) ) {
		systemPreferences.setUserDefault(
			'AppleLanguages',
			'array',
			Intl.getCanonicalLocales( locale )
		);
	}
}

export function loadLocaleData( locale: string ) {
	defaultI18n.resetLocaleData( getLocaleData( locale )?.messages );
}
