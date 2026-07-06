import { getLocaleData, isSupportedLocale } from '@studio/common/lib/locale';
import { defaultI18n } from '@wordpress/i18n';
import type { Connector } from '@/data/core';

/**
 * Resolves the user's locale from the connector, loads its translations into
 * the shared i18n instance, and reflects it on the document element as `lang`
 * and `dir`.
 *
 * The `lang` attribute is what locale-scoped CSS keys off (e.g. the bundled
 * Central Kurdish font in `index.css`, matched via `:lang(ckb)`), and `dir`
 * gives RTL locales the correct text direction. The bare `index.html` files
 * ship with `lang="en"`, so without this the document would stay English/LTR
 * even after translations load.
 */
export async function applyLocale( connector: Connector ): Promise< void > {
	const { locale } = await connector.getUserPreferences();
	if ( ! locale || ! isSupportedLocale( locale ) ) {
		return;
	}

	const translations = getLocaleData( locale )?.messages;
	if ( translations ) {
		defaultI18n.setLocaleData( translations );
	}

	// `html_lang_attribute` lets a locale override the slug used for the `lang`
	// attribute; fall back to the locale slug when it isn't translated.
	const htmlLang = defaultI18n.__( 'html_lang_attribute' );
	document.documentElement.lang = htmlLang === 'html_lang_attribute' ? locale : htmlLang;

	// `isRTL()` reads the translated `ltr`/`rtl` direction string from the loaded
	// data, so it must run after `setLocaleData`.
	document.documentElement.dir = defaultI18n.isRTL() ? 'rtl' : 'ltr';
}
