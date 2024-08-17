export const supportedLocaleNames = {
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
export type SupportedLocale = keyof typeof supportedLocaleNames;

export const supportedLocales = Object.keys( supportedLocaleNames ) as SupportedLocale[];

export function isSupportedLocale( locale: string ): locale is SupportedLocale {
	return supportedLocales.includes( locale as SupportedLocale );
}
