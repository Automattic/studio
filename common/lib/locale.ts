// This file can be used in React and Node
import { localeDataDictionary } from 'common/translations';

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

export function isSupportedLocale( locale: string | undefined ): locale is SupportedLocale {
	if ( ! locale ) {
		return false;
	}
	return supportedLocales.includes( locale as SupportedLocale );
}

/**
 * Maps Studio locale codes to their corresponding WordPress locale codes.
 * Used for downloading and installing WordPress core language packs.
 */
export const studioToWpLocaleMap: Partial< Record< SupportedLocale, string > > = {
	ar: 'ar',
	de: 'de_DE',
	es: 'es_ES',
	fr: 'fr_FR',
	he: 'he_IL',
	id: 'id_ID',
	it: 'it_IT',
	ja: 'ja',
	ko: 'ko_KR',
	nl: 'nl_NL',
	pl: 'pl_PL',
	'pt-br': 'pt_BR',
	ru: 'ru_RU',
	sv: 'sv_SE',
	tr: 'tr_TR',
	vi: 'vi',
	uk: 'uk',
	'zh-cn': 'zh_CN',
	'zh-tw': 'zh_TW',
};
