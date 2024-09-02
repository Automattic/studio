// This file can be used in React and Node
import { localeDataDictionary } from '../translations';

export const DEFAULT_LOCALE = 'en';

export type SupportedLocale = keyof typeof localeDataDictionary;

export const supportedLocaleNames: Record< SupportedLocale, string > = {
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
	vi: 'Tiếng Việt',
	uk: 'Українська',
	'zh-cn': '简体中文',
	'zh-tw': '繁體中文',
};

export const supportedLocales = Object.keys( supportedLocaleNames ) as SupportedLocale[];

export function getLocaleData( locale: string ) {
	if ( locale in localeDataDictionary ) {
		return localeDataDictionary[ locale as SupportedLocale ];
	}
	return null;
}

export function isSupportedLocale( locale: string ): locale is SupportedLocale {
	return supportedLocales.includes( locale as SupportedLocale );
}
