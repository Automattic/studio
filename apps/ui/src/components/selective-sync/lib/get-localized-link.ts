import { SupportedLocale } from '@studio/common/lib/locale';

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
	docsSyncSupportedSites: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/sync/#supported-sites',
		es: 'https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/sync/#sitios-compatibles',
	},
	docsCli: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/cli/',
		es: 'https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/cli/',
	},
	docsBlueprints: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/blueprints/',
	},
	docsXdebug: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/xdebug/',
	},
	docsSslInStudio: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/ssl-in-studio/',
	},
	docsMcp: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/mcp-on-studio/',
	},
	docsSkills: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/agent-skills-wordpress-studio/',
	},
	docsStudioCode: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/studio-code/',
	},
	docsPhpRuntimes: {
		en: 'https://developer.wordpress.com/docs/developer-tools/studio/php-runtimes/',
	},
} satisfies Record< `docs${ string }`, TranslatedLink >;

const BLOG_LINKS = {
	blogPreferredApps: {
		en: 'https://wordpress.com/blog/2025/05/12/preferences-studio/',
	},
	blogPreviewSites: {
		en: 'https://wordpress.com/blog/2025/02/24/studio-preview-sites/',
		es: 'https://wordpress.com/es/blog/2025/03/05/colabora-mas-y-mejor-en-studio-con-los-sitios-de-vista-previa/',
		fr: 'https://wordpress.com/fr/blog/2025/03/04/sites-de-previsualisation-studio/',
		ja: 'https://wordpress.com/ja/blog/2025/03/28/studio-preview-sites/',
		'pt-br': 'https://wordpress.com/pt-br/blog/2025/03/06/estudio-visualizar-sites/',
	},
} satisfies Record< `blog${ string }`, TranslatedLink >;

const A8C_LINKS = {
	a8cAiGuidelines: {
		en: 'https://automattic.com/ai-guidelines/',
	},
	a8cPrivacyPolicy: {
		en: 'https://automattic.com/privacy/',
	},
	a8cTos: {
		en: 'https://wordpress.com/tos/',
	},
} satisfies Record< `a8c${ string }`, TranslatedLink >;

const LINKS = {
	...BLOG_LINKS,
	...DOCS_LINKS,
	...A8C_LINKS,
} as const satisfies Record< string, TranslatedLink >;

export type DocsLinkKey = keyof typeof LINKS;

/**
 * Returns the link for the given locale if it exists, otherwise, returns the English link.
 */
export function getLocalizedLink( locale: SupportedLocale, linkKey: DocsLinkKey ): string {
	const links = LINKS[ linkKey ];
	if ( locale in links ) {
		return links[ locale as keyof typeof links ];
	}
	return links.en;
}
