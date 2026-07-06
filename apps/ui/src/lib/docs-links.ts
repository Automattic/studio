import type { SupportedLocale } from '@studio/common/lib/locale';

type TranslatedLink = Partial< Record< SupportedLocale, string > > & { en: string };

/**
 * Documentation URLs surfaced from `apps/ui`. Keep in sync with the larger
 * catalog in `apps/studio/src/lib/get-localized-link.ts` — only the keys that
 * `apps/ui` actually links to are duplicated here.
 */
const DOCS_LINKS = {
	docsSites: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/sites/',
		es: 'https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/sitios/',
	},
	docsSslInStudio: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/ssl-in-studio/',
	},
} as const satisfies Record< string, TranslatedLink >;

export type DocsLinkKey = keyof typeof DOCS_LINKS;

export function getLocalizedLink( locale: SupportedLocale | undefined, key: DocsLinkKey ): string {
	const links = DOCS_LINKS[ key ];
	if ( locale && locale in links ) {
		return links[ locale as keyof typeof links ] ?? links.en;
	}
	return links.en;
}
