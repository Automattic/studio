import { getLocaleData, isSupportedLocale } from '@studio/common/lib/locale';
import { defaultI18n } from '@wordpress/i18n';
import type { Connector } from '@/data/core';

/**
 * Loads the user's locale translations and reflects `lang`/`dir` on the
 * document element (locale-scoped CSS keys off `lang`; the index.html files
 * ship with `lang="en"`).
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

	// A locale may override its `lang` slug via `html_lang_attribute`.
	const htmlLang = defaultI18n.__( 'html_lang_attribute' );
	document.documentElement.lang = htmlLang === 'html_lang_attribute' ? locale : htmlLang;

	// isRTL() reads the direction from the loaded data, so it must run after setLocaleData.
	document.documentElement.dir = defaultI18n.isRTL() ? 'rtl' : 'ltr';
}
