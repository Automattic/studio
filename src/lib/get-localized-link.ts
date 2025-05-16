import { SupportedLocale } from 'common/lib/locale';

// English is always required, and the other locales are optional.
type TranslatedLink = Partial< Record< SupportedLocale, string > > & { en: string };

const DOCS_LINKS = {
	docsStudio: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/',
		es: 'https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/',
	},
	docsImportExport: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/import-export/',
		es: 'https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/importar-exportar/',
	},
	docsSites: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/sites/',
		es: 'https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/sitios/',
	},
	docsSync: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/sync/',
		es: 'https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/sync/',
	},
	docsCli: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/cli/',
	},
} satisfies Record< `docs${ string }`, TranslatedLink >;

const BLOG_LINKS = {
	blogPreferredApps: {
		en: 'https://wordpress.com/blog/2025/05/12/preferences-studio/',
	},
	blogPhpVersions: {
		en: 'https://wordpress.com/blog/2025/03/17/studio-wordpress-php-versions/',
		es: 'https://wordpress.com/es/blog/2025/04/02/modifica-las-versiones-de-wordpress-y-php-de-tu-sitio-local-con-studio/',
		fr: 'https://wordpress.com/fr/blog/2025/03/28/studio-wordpress-php-versions/',
		'pt-br': 'https://wordpress.com/pt-br/blog/2025/04/02/estudio-wordpress-php-versoes/',
	},
	blogPreviewSites: {
		en: 'https://wordpress.com/blog/2025/02/24/studio-preview-sites/',
		es: 'https://wordpress.com/es/blog/2025/03/05/colabora-mas-y-mejor-en-studio-con-los-sitios-de-vista-previa/',
		fr: 'https://wordpress.com/fr/blog/2025/03/04/sites-de-previsualisation-studio/',
		ja: 'https://wordpress.com/ja/blog/2025/03/28/studio-preview-sites/',
		'pt-br': 'https://wordpress.com/pt-br/blog/2025/03/06/estudio-visualizar-sites/',
	},
	blogCustomDomainsHttps: {
		en: 'https://wordpress.com/blog/2025/03/31/studio-custom-domains-https/',
		es: 'https://wordpress.com/es/blog/2025/03/31/studio-custom-domains-https/',
		'pt-br': 'https://wordpress.com/pt-br/blog/2025/04/03/estudio-dominios-personalizados-https/',
	},
} satisfies Record< `blog${ string }`, TranslatedLink >;

const LINKS = {
	...BLOG_LINKS,
	...DOCS_LINKS,
} as const satisfies Record< string, TranslatedLink >;

/**
 * Returns the link for the given locale if it exists, otherwise, returns the English link.
 */
export function getLocalizedLink( locale: SupportedLocale, linkKey: keyof typeof LINKS ): string {
	const links = LINKS[ linkKey ];
	if ( locale in links ) {
		return links[ locale as keyof typeof links ];
	}
	return links.en;
}
