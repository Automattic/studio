import { app } from 'electron';
import { match } from '@formatjs/intl-localematcher';
import * as Sentry from '@sentry/electron/main';
import type { LocaleData } from '@wordpress/i18n';

export const DEFAULT_LOCALE = 'en';

export const supportedLocales = {
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

export function getPreferredSystemLanguages() {
	if ( process.platform === 'linux' && process.env.NODE_ENV !== 'test' ) {
		return app
			.getPreferredSystemLanguages()
			.filter( ( lang ) => Object.keys( supportedLocales ).includes( lang ) );
	}

	return app.getPreferredSystemLanguages();
}

export function getSupportedLocale(): string {
	return match( getPreferredSystemLanguages(), Object.keys( supportedLocales ), DEFAULT_LOCALE );
}

export function getLocaleData( locale: string ): LocaleData | null {
	if ( locale === DEFAULT_LOCALE || ! Object.keys( supportedLocales ).includes( locale ) ) {
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
