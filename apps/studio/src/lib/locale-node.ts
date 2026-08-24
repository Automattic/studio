import { app } from 'electron';
import { match } from '@formatjs/intl-localematcher';
import {
	DEFAULT_LOCALE,
	isSupportedLocale,
	SupportedLocale,
	supportedLocales,
} from '@studio/common/lib/locale';
import { readSharedConfig, updateSharedConfig } from '@studio/common/lib/shared-config';

export function getSupportedLocale() {
	// `app.getLocale` returns the current application locale, acquired using
	// Chromium's `l10n_util` library. This value is utilized to determine
	// the best fit for supported locales.
	const matched = match( [ app.getLocale() ], supportedLocales, DEFAULT_LOCALE );
	// `match` canonicalizes BCP-47 casing (e.g. `zh-cn` -> `zh-CN`), but our
	// supported-locale keys are lowercase
	return matched.toLowerCase() as SupportedLocale;
}

export async function getUserLocaleWithFallback() {
	try {
		const { locale } = await readSharedConfig();
		if ( locale && isSupportedLocale( locale ) ) {
			return locale;
		}
	} catch {
		// Fall through to system detection.
	}
	// shared.json has no locale — detect from the OS and persist so the CLI
	// (a plain Node.js child process without Electron) can read it.
	const detected = getSupportedLocale();
	void updateSharedConfig( { locale: detected } ).catch( () => undefined );
	return detected;
}
