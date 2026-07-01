// This file can be used in React and Node
import { localeDataDictionary } from '@studio/common/translations';

export const DEFAULT_LOCALE = 'en';

export type SupportedLocale = keyof typeof localeDataDictionary;

export const supportedLocaleNames: Record< SupportedLocale, string > = {
	ar: 'العربية',
	ckb: 'کوردیی ناوەندی',
	de: 'Deutsch',
	en: 'English',
	es: 'Español',
	fr: 'Français',
	he: 'עברית',
	hu: 'Magyar',
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
	vi: 'Tiếng Việt',
	uk: 'Українська',
	'zh-cn': '简体中文',
	'zh-tw': '繁體中文',
};

export const supportedLocales = Object.keys( supportedLocaleNames ).filter( isSupportedLocale );

export function getLocaleData( locale: string ) {
	if ( isSupportedLocale( locale ) ) {
		return localeDataDictionary[ locale ];
	}
	return null;
}

export function isSupportedLocale( locale: string | undefined ): locale is SupportedLocale {
	if ( ! locale ) {
		return false;
	}
	return Object.prototype.hasOwnProperty.call( localeDataDictionary, locale );
}
