import { getLocaleData, isSupportedLocale } from '@studio/common/lib/locale';
import { _x, defaultI18n } from '@wordpress/i18n';
import { queryClient } from '@/data/core';
import { USER_PREFERENCES_QUERY_KEY } from '@/data/queries/use-user-preferences';
import { applyTheme, resolveColorScheme } from '@/lib/theme';
import type { Connector } from '@/data/core';

/**
 * Applies the saved theme and language before the first render, and seeds the
 * preferences query with them so the first render paints the same theme.
 */
export async function applyUserPreferences( connector: Connector ): Promise< void > {
	// Browser connectors fetch preferences over the network, so a hiccup here
	// must not keep the app from rendering — it just stays in English.
	const preferences = await connector.getUserPreferences().catch( () => undefined );
	if ( preferences ) {
		queryClient.setQueryData( USER_PREFERENCES_QUERY_KEY, preferences );
	}
	applyTheme( resolveColorScheme( preferences?.colorScheme ), preferences ?? {} );
	applyLocale( preferences?.locale );
}

/**
 * Loads the locale's translations, reflects `lang`/`dir` on the document
 * element (locale-scoped CSS keys off `lang`; the index.html files ship with
 * `lang="en"`) and loads the stylesheets for that direction.
 */
function applyLocale( locale: string | undefined ) {
	if ( locale && isSupportedLocale( locale ) ) {
		const translations = getLocaleData( locale )?.messages;
		if ( translations ) {
			defaultI18n.setLocaleData( translations );
		}

		// A locale may override its `lang` slug via `html_lang_attribute`.
		const htmlLang = defaultI18n.__( 'html_lang_attribute' );
		document.documentElement.lang = htmlLang === 'html_lang_attribute' ? locale : htmlLang;

		// isRTL() looks up the translation of the special string `ltr`; this call keeps
		// it in the extracted strings, so RTL locales translate it.
		_x( 'ltr', 'text direction' );
		// isRTL() reads the direction from the loaded data, so it must run after setLocaleData.
		document.documentElement.dir = defaultI18n.isRTL() ? 'rtl' : 'ltr';
	}
}
